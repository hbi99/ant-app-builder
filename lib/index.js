
const btoa = require("btoa")
const convert = require("xml-js")
const less = require("less")
const rollup = require("rollup")
const terser = require("terser")

const { FS } = require("./common")
const buildFileLimit = 1024 * 1024 * 5


// ** Get meta values from application <Head>
const getMetaValue = (meta, name, attr) => {
	let m = meta.find(item => item && item._attributes.name === name)
	return m ? m._attributes[attr ? attr : "value"] : false
}

// ** Compiles javascript
const compileScript = async (meta, appPath, uglify) => {
	const filePath = FS.path.join(appPath, getMetaValue(meta, "script"))
	const dirPath = FS.path.dirname(filePath)
	
	// rollup.js
	const bundle = await rollup.rollup({ input: filePath })
	const { output } = await bundle.generate({ format: "esm" })

	// custom require-parser
	let code = output[0].code
	let regexp = /require\(['"](.+?)['"]\)/g
	const requires = code.match(regexp) || []
	const modules = await Promise.all(requires.map(async item => {
		const requirePath = FS.path.join(dirPath, item.slice(9,-2))
		return await FS.readFile(requirePath)
	}))
	code = modules.join("\n") + code.replace(regexp, "")

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
	let cssFile = getMetaValue(meta, "style", "toolbar")
	let filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	let options = { compress: true }
	let toolbar_output = ""
	let winbody_output = ""
	let statusbar_output = ""
	let data = ""

	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		toolbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-toolbar_ {${data.toString()}}`, options)
		toolbar_output = toolbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}

	cssFile = getMetaValue(meta, "style", "statusbar")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		statusbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-status-bar_ {${data.toString()}}`, options)
		statusbar_output = statusbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}
	cssFile = getMetaValue(meta, "style")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		let dirPath = FS.path.dirname(filePath)
		data = await FS.readFile(filePath)
		data = data.toString().replace(/(@import ("|'))/g, `$1${dirPath}/`)
		winbody_output = await less.render(`.ant-window_[data-id="${id}"] ${isHeadless ? "": ".window-body_"} {${data}}`, options)
		winbody_output = winbody_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}
	return toolbar_output + winbody_output + statusbar_output
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
				.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)

		let regexp = /@import ['"](.+?)['"]/mg
		let imports = data.match(regexp) || []

		await Promise.all(imports.map(async item => {
			let importPath = FS.path.join(dirPath, item.slice(9,-1))
			let importFile = await FS.readFile(importPath)
			let rx = new RegExp(item, "im")
			data = data.replace(rx, importFile)
		}))

		data = data.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)

		return uglify ? data.replace(/\n|\t/g, "") : data
	}
}

// ** Compiles svg icons
async function compileIcons(meta, appPath) {
	let iconFile = getMetaValue(meta, "icons")
	let filePath = iconFile ? FS.path.join(appPath, iconFile) : ""

	if (iconFile && await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString().replace(/\t|\n/g, "")
		return data
	}
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
		const meta = JSON.parse(appJson).Application.Head.meta
		const appId = getMetaValue(meta, "id")
		const name = getMetaValue(meta, "title")
		const version = getMetaValue(meta, "title", "version")
		const buildInclude = (getMetaValue(meta, "build", "include") || "").split(",")
		
		let scriptCompiled = await compileScript(meta, srcDir, uglify) || ""
		let styleCompiled = await compileStyle(meta, srcDir) || ""
		let xslCompiled = await compileXsl(meta, srcDir) || ""
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

		let replaceHtml = `</Head> ${xslCompiled}`+
							`<script><![CDATA[ ${scriptCompiled} ]]></script>`+
							`<style><![CDATA[ ${styleCompiled} ]]></style>`+
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
			uglified: uglify,
			size: appXml.length,
			buildPath: destDir.slice(process.cwd().length + 1),
			files,
		})
	})
}


module.exports = {
	Build,
}
