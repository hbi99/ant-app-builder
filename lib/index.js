
const btoa = require("btoa")
const convert = require("xml-js")
const less = require("less")
const rollup = require("rollup")
const terser = require("terser")
const jsonminify = require("jsonminify")

const { FS } = require("./common")
const buildFileLimit = 1024 * 1024 * 5
const ant_require_rx = /defiant\.require\(['"](.+?)['"]\)/g


// ** Get meta values from application <Head>
const getMetaValue = (meta, name, attr) => {
	let m = meta.find(item => item && item._attributes.name === name)
	return m ? m._attributes[attr ? attr : "value"] : false
}

const buildTasks = async (appXmlDom, appPath, id, namespace, uglify) => {
	const xApp = appXmlDom.Application
	if (!xApp.Build || !xApp.Build.task) return

	let buildTasks = xApp.Build.task
	if (buildTasks.constructor !== Array) buildTasks = [buildTasks]

	// check if task is to be skipped
	buildTasks = buildTasks.filter(task => task._attributes.action !== "skip")

	return Promise.all(buildTasks.map(async task => {
		let input = FS.path.join(appPath, task._attributes.source)
		let dest = FS.path.join(appPath, task._attributes.destination)
		let destDir = FS.path.dirname(dest)
		let _uglify = task._attributes.action === "uglify" || uglify

		let ant_require = async function(baseDir, reqStr, exclude) {
			let reqPath = FS.path.join(baseDir, reqStr.slice(17,-2))
			if (!await FS.fileExists(reqPath)) return

			let reqFile = await FS.readFile(reqPath)
			let rx = new RegExp(reqStr.replace(/(\(|\))/g, "\\$1"), "i")
			code = code.replace(rx, reqFile)

			let requires = code.match(ant_require_rx) || []
			if (exclude) {
				requires = requires.filter(i => exclude.indexOf(i))
			}
			if (requires.length) {
				let reqDir = FS.path.dirname(reqPath)
				await Promise.all(requires.map(async item => ant_require(reqDir, item, requires)))
			}
		}

		// rollup.js
		let bundle = await rollup.rollup({ input, treeshake: false })
		let { output } = await bundle.generate({ format: "esm" })

		// custom require-parser
		let code = output[0].code
		let requires = code.match(ant_require_rx) || []
		
		let reqDir = FS.path.dirname(input)
		await Promise.all(requires.map(async item => ant_require(reqDir, item)))

		// fix paths to app public folder
		code = code.replace(/(['"])~\/(.+?)(['"])/g, `$1/app/${namespace}/${id}/$2$3`)

		// terser.js
		const options = { compress: true, module: true }
		const parsed = terser.minify(code, options)

		// create destination dir, if it doesnt exist
		if (!await FS.fileExists(destDir)) {
			await FS.mkDir(destDir)
		}

		await FS.writeFile(dest, _uglify ? parsed.code : code)
	}))
}

// ** Compiles javascript
const compileScript = async (meta, appPath, uglify) => {
	let id = getMetaValue(meta, "id")
	let namespace = getMetaValue(meta, "author", "namespace")
	const filePath = FS.path.join(appPath, getMetaValue(meta, "script"))
	const dirPath = FS.path.dirname(filePath)

	// reqursive file "ant_require"
	const requireFile = async function(baseDir, reqStr, exclude) {
		let reqPath = FS.path.join(baseDir, reqStr.slice(17,-2))
		if (!await FS.fileExists(reqPath)) return

		let reqFile = await FS.readFile(reqPath)
		let rx = new RegExp(reqStr.replace(/(\(|\))/g, "\\$1"), "i")
		code = code.replace(rx, reqFile)

		exclude = exclude || []
		exclude.push(reqStr)

		let requires = code.match(ant_require_rx) || []
		if (exclude) {
			requires = requires.filter(i => exclude.indexOf(i))
		}
		if (requires.length) {
			let reqDir = FS.path.dirname(reqPath)
			await Promise.all(requires.map(async item => requireFile(reqDir, item, requires)))
		}
	}
	
	// rollup.js
	let bundle = await rollup.rollup({ input: filePath, treeshake: false })
	let { output } = await bundle.generate({ format: "esm" })

	// custom require-parser
	let code = output[0].code
	if (uglify) {
		// remove development-only code
		code = code.replace(/\/\/ DEV-ONLY-START[\w\W]+\/\/ DEV-ONLY-END$/gm, "")
	}

	let requires = code.match(ant_require_rx) || []
	// loop all requires
	await Promise.all(requires.map(async item => requireFile(dirPath, item)))

	// fix paths to app public folder
	code = code.replace(/(['"])~\/(.+?)(['"])/g, `$1/app/${namespace}/${id}/$2$3`)

	// terser.js
	const options = { compress: true, module: true }
	const parsed = terser.minify(code, options)

	return uglify ? parsed.code : code
}

// ** Compiles styles (less files)
const compileStyle = async (meta, appPath) => {
	let id = getMetaValue(meta, "id")
	let namespace = getMetaValue(meta, "author", "namespace")
	let isHeadless = getMetaValue(meta, "headless")
	let cssFile = getMetaValue(meta, "toolbar-style")
	let filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	let options = { compress: true }
	let toolbar_output = ""
	let winbody_output = ""
	let statusbar_output = ""
	let dialog_output = ""
	let data = ""

	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		toolbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-toolbar_, .ant-window_[data-id="${id}"] .win-caption-toolbar_ {${data.toString()}}`, options)
		toolbar_output = toolbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}

	cssFile = getMetaValue(meta, "statusbar-style")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		statusbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-status-bar_ {${data.toString()}}`, options)
		statusbar_output = statusbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}

	cssFile = getMetaValue(meta, "dialog-style")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		dialog_output = await less.render(`.ant-window_[data-id="${id}"] .dialog_ {${data.toString()}}`, options)
		dialog_output = dialog_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}

	cssFile = getMetaValue(meta, "style")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		let dirPath = FS.path.dirname(filePath)
		data = await FS.readFile(filePath)
		data = data.toString().replace(/(@import ("|'))/g, `$1${dirPath}/`)
		winbody_output = await less.render(`.ant-window_[data-id="${id}"] ${isHeadless ? "": ".win-body_"} {${data}}`, options)
		winbody_output = winbody_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}
	return toolbar_output + winbody_output + statusbar_output + dialog_output
}

// ** Compiles xsl
async function compileXsl(meta, appPath) {
	let id = getMetaValue(meta, "id")
	let namespace = getMetaValue(meta, "author", "namespace")
	let xslFile = getMetaValue(meta, "xsl")
	let filePath = xslFile? FS.path.join(appPath, xslFile) : ""

	if (xslFile && await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString()
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
		return data
	}
}

// ** Compiles content
async function compileContent(meta, appPath, uglify) {
	let id = getMetaValue(meta, "id")
	let namespace = getMetaValue(meta, "author", "namespace")
	let htmFile = getMetaValue(meta, "content")
	let filePath = htmFile ? FS.path.join(appPath, htmFile) : ""
	let dirPath = FS.path.dirname(filePath)

	if (htmFile && await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString()
				.replace(/=(['"])~\/(.+?)(['"])/g, `=$1/app/${namespace}/${id}/$2$3`)
				.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)

		const importFile = async (baseDir, importStr, exclude) => {
			let importPath = FS.path.join(baseDir, importStr.slice(9,-1))
			if (!await FS.fileExists(importPath)) return

			let importedFile = await FS.readFile(importPath)
			let rx = new RegExp(importStr, "im")
			data = data.replace(rx, importedFile)

			let subImports = data.match(regexp) || []
			if (exclude) {
				subImports = subImports.filter(i => exclude.indexOf(i))
			}
			if (subImports.length) {
				let importDir = FS.path.dirname(importPath)
				await Promise.all(subImports.map(async item => importFile(importDir, item, subImports)))
			}
		}

		// find all imports
		let regexp = /@import ['"](.+?)['"]/mg
		let imports = data.match(regexp) || []
		// loop all requires
		await Promise.all(imports.map(async item => importFile(dirPath, item)))

		data = data.replace(/@store ['"](.+?)['"]/mg, "")
		data = data.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)

		return uglify ? data.replace(/\n|\t/g, "") : data
	}
}

// ** gets content stores
async function getContentStores(meta, appPath, uglify) {
	let id = getMetaValue(meta, "id")
	let namespace = getMetaValue(meta, "author", "namespace")
	let htmFile = getMetaValue(meta, "content")
	let filePath = htmFile ? FS.path.join(appPath, htmFile) : ""
	let dirPath = FS.path.dirname(filePath)
	let result = []

	if (htmFile && await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)

		let regexp = /@store ['"](.+?)['"]/mg
		let imports = data.toString().match(regexp) || []

		await Promise.all(imports.map(async item => {
			let importPath = FS.path.join(dirPath, item.slice(8,-1))
			let importFile = await FS.readFile(importPath)
			let str = uglify ? importFile.toString().replace(/\t|\n/g, "") : importFile.toString()
			
			str = str.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			result.push(`<i id="${item.slice(8,-1)}"><![CDATA[ ${str} ]]></i>`)
		}))

		return result.join("")
	}
}

// ** Compiles svg icons
async function compileIcons(meta, appPath) {
	let iconFile = getMetaValue(meta, "icons")
	let filePath = iconFile ? FS.path.join(appPath, iconFile) : ""
	let dirPath = FS.path.dirname(filePath)

	if (iconFile && await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString().replace(/\t|\n/g, "")

		let regexp = /@import ['"](.+?)['"]/mg
		let imports = data.match(regexp) || []
		await Promise.all(imports.map(async item => {
			let importPath = FS.path.join(dirPath, item.slice(9,-1))
			let importFile = await FS.readFile(importPath)
			let rx = new RegExp(item, "im")
			data = data.replace(rx, importFile)
		}))
		
		return data
	}
}


// ** Monifies JS modules
const MinifyModules = (srcDir) => {
	return new Promise(async (resolve, reject) => {
		let files = await FS.listDir(srcDir)
		
		// remove existing minified modules
		let removes = files.filter(filePath => {
			let parsed = FS.path.parse(filePath)
			return [".js", ".json"].includes(parsed.ext) && filePath.endsWith(".min"+ parsed.ext)
		})
		await Promise.all(removes.map(filePath => FS.unlink(filePath)))

		// remove deleted files from files list
		files = files.filter(f => !removes.includes(f))

		// minify modules
		await Promise.all(files.map(async filePath => {
			let parsed = FS.path.parse(filePath)
			let destPath = FS.path.join(parsed.dir, parsed.name +".min"+ parsed.ext)
			let file = await FS.readFile(filePath)
			let options, minified

			switch (parsed.ext) {
				case ".js":
					// terser.js
					options = { compress: true, module: true }
					minified = terser.minify(file.toString(), options)
					break
				case ".json":
					minified = { code: jsonminify(file.toString()) }
					break
			}

			await FS.writeFile(destPath, minified.code)
		}))
	})
}


// ** Builds def-ant application
const Build = (srcDir, destDir, uglify) => {
	return new Promise(async (resolve, reject) => {
		let parsed = FS.path.parse(destDir)
		if (!parsed.ext && await FS.fileExists(destDir)) {
			// first clean up
			await FS.deleteDir(destDir)
		}

		let appXml = await FS.readFile(`${srcDir}/index.xml`)
		appXml = appXml.toString()
		appXml = appXml.replace(/\t|\n/g, "")

		const appJson = convert.xml2json(appXml, { compact: true })
		const appXmlDom = JSON.parse(appJson)
		const meta = appXmlDom.Application.Head.meta
		const appId = getMetaValue(meta, "id")
		const name = getMetaValue(meta, "title")
		const version = getMetaValue(meta, "title", "version")
		const buildInclude = (getMetaValue(meta, "build", "include") || "").split(",")
		const namespace = getMetaValue(meta, "author", "namespace")

		// perform build tasks - if any
		await buildTasks(appXmlDom, srcDir, appId, namespace, uglify);

		let scriptCompiled = await compileScript(meta, srcDir, uglify) || ""
		let styleCompiled = await compileStyle(meta, srcDir) || ""
		let xslCompiled = await compileXsl(meta, srcDir) || ""
		let contentStores = await getContentStores(meta, srcDir, uglify) || ""
		let contentCompiled = await compileContent(meta, srcDir, uglify) || ""
		let iconsCompiled = await compileIcons(meta, srcDir) || ""

		let regexp = /@import ['"](.+?)['"]/mg
		let imports = appXml.match(regexp) || []
		await Promise.all(imports.map(async item => {
			let importPath = FS.path.join(srcDir, item.slice(9,-1))
			let importFile = await FS.readFile(importPath)
			let rx = new RegExp(item, "im")
			appXml = appXml.replace(rx, importFile)
		}))
		// fixes urls in xml, starting with '~'
		appXml = appXml.replace(/(url=")\~/g, `$1/app/${namespace}/${appId}`)
		appXml = appXml.replace(/=(['"])~\/(.+?)(['"])/g, `=$1/app/${namespace}/${appId}/$2$3`)

		let replaceHtml = `</Head> ${xslCompiled}`+
							`<script><![CDATA[ ${scriptCompiled} ]]></script>`+
							`<style><![CDATA[ ${styleCompiled} ]]></style>`+
							`<DomStore>${contentStores}</DomStore>`+
							`<WindowBody><![CDATA[ ${contentCompiled} ]]></WindowBody>`+
							`<WindowIcons><![CDATA[ ${iconsCompiled} ]]></WindowIcons>`

		appXml = appXml.replace(/<\/Head>/, replaceHtml)
		if (uglify) appXml = appXml.replace(/\n|\t/g, "")

		// create destination dir, if it doesnt exist
		if (!parsed.ext && !await FS.fileExists(destDir)) {
			await FS.mkDir(destDir)
		}
		let destFile = FS.path.join(destDir, parsed.ext ? "" : "index.xml")
		await FS.writeFile(destFile, appXml)

		// copy public folder fontent
		let srcPublic = FS.path.join(srcDir, "public")
		if (await FS.fileExists(srcPublic)) {
			let exclude = { ext: [".psd", ".ai"], size: buildFileLimit }
			
			buildInclude.map(item => {
				let isExt = exclude.ext.indexOf(item)
				if (isExt > -1) exclude.ext.splice(isExt, 1)
			})

			await FS.copyDir(srcPublic, destDir, exclude)
		}
		
		let stat = await FS.fileStat(destDir)
		let files = [destFile]
		if (stat.isDirectory()) {
			files = await FS.listDir(destDir)
			files = files.map(f => f.slice(destDir.length + 1))
		}

		resolve({
			version,
			name,
			id: appId,
			uglified: uglify || false,
			size: appXml.length,
			buildPath: destDir,
			buildDir: destDir.slice(process.cwd().length + 1),
			files,
		})
	})
}


module.exports = {
	Build,
	MinifyModules,
}
