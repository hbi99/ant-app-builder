
const convert = require("xml-js")
const less = require("less")
const rollup = require("rollup")
const terser = require("terser")

const { FS } = require("./common")
const buildFileLimit = 1024 * 1024 * 5 // = 5 MB
const ant_require_rx = /@import ['"](.+?)['"]/mg


// ** Get meta values from application <Head>
const getMetaValue = (meta, name, attr) => {
	let m = meta.find(item => item && item._attributes.name === name)
	return m ? m._attributes[attr ? attr : "value"] : false
}


// ** Ensures safe CSS animation definitions for application scope
const safeAnimDefScope = (id, css) => {
	let out = css
	let names = []

	// capture all keyframe names
	out.replace(/@keyframes (\w[a-z-_]+) {/ig, (all, mmatch) => names.includes(mmatch) ? null : names.push(mmatch))
	names = names.map(i => i.trim())
	out = out.replace(/@keyframes (\w[a-z-_]+) \{/ig, `@keyframes $1-${id} {`)

	// replace all mixed animation-names
	out = out.replace(/animation:[a-z \d\D-,]*?;/mig, (all, mmatch) => {
		let str = all
		names.map(key => {
			let rx = new RegExp(`\\b${key}\\b`, "g")
			str = str.replace(rx, `${key}-${id}`)
		})
		return str
	})
	
	// replace all animation-names
	out = out.replace(/animation-name:[a-z \d\D-,]*?;/mig, (all, mmatch) => {
		let str = all
		names.map(key => {
			let rx = new RegExp(`\\b${key}\\b`, "g")
			str = str.replace(rx, `${key}-${id}`)
		})
		return str
	})

	return out
}


// ** Build tasks for application
const buildTasks = async (appXmlDom, appPath, id, namespace, uglify) => {
	let xApp = appXmlDom.Application
	if (!xApp.Build || !xApp.Build.task) return

	let buildTasks = xApp.Build.task
	if (buildTasks.letructor !== Array) buildTasks = [buildTasks]

	// check if task is to be skipped
	buildTasks = buildTasks.filter(task => uglify || task._attributes.action !== "skip")

	return Promise.all(buildTasks.map(async task => {
		let input = FS.path.join(appPath, task._attributes.source)
		let dest = FS.path.join(appPath, task._attributes.destination)
		let destDir = FS.path.dirname(dest)
		let _uglify = task._attributes.action === "minify" || uglify

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
		let options = { compress: true, module: true }
		let parsed = terser.minify(code, options)

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
	let filePath = FS.path.join(appPath, getMetaValue(meta, "script"))
	let fileData = await FS.readFile(filePath)
	let dirPath = FS.path.dirname(filePath)

	// reqursive file "ant_require"
	let requireFile = async (base, importStr, ignore=[]) => {
		let importPath = FS.path.join(base, importStr.slice(9,-1))
		let exists = await FS.fileExists(importPath)
		
		// if import does not exist, don't do anything more
		if (exists) {
			// if import file exists, import it
			repl = await FS.readFile(importPath)
			// replace with content
			let rx = new RegExp(importStr, "i")
			code = code.replace(rx, repl)
		}

		// this import path can be ignored
		ignore.push(importPath);

		let reqs = code.match(ant_require_rx) || []
		reqs = reqs.filter(i => !ignore.includes(i))

		if (reqs.length) {
			let baseDir = FS.path.dirname(importPath)
			await Promise.all(reqs.map(async item => requireFile(baseDir, item, reqs)))
		}
	}

	// loop all "@imports"
	let code = fileData.toString()
	let requires = code.match(ant_require_rx) || []
	await Promise.all(requires.map(async item => requireFile(dirPath, item, requires)))
	
	// if there is any more imports, they can't be resolved
	requires = code.match(ant_require_rx) || []
	requires.map(path => {
		let rx = new RegExp(importStr, "i")
		let repl = `(() => {throw "File not found: ${importStr.slice(9,-1)}";})()`
		code = code.replace(rx, repl)
	})

	// save temp input entry file
	let input = filePath.slice(0, filePath.lastIndexOf("/") + 1) + Date.now() +".js"
	await FS.writeFile(input, code)

	// rollup.js
	let bundle
	try {
		bundle = await rollup.rollup({ input, treeshake: false, context: "window" })
	} catch (err) {
		// delete temp input entry file
		await FS.unlink(input)
		// throw error
		throw err
	}

	// delete temp input entry file
	await FS.unlink(input)

	let { output } = await bundle.generate({ format: "esm" })

	// custom require-parser
	code = output[0].code
	if (uglify) {
		// remove development-only code
		code = code.replace(/\/\/ DEV-ONLY-START[\w\W]+\/\/ DEV-ONLY-END$/gm, "")
	}

	// fix paths to app public folder
	code = code.replace(/(['"])~\/(.+?)(['"])/g, `$1/app/${namespace}/${id}/$2$3`)

	if (uglify) {
		// terser.js
		let options = { compress: false, module: false, mangle: uglify }
		let parsed = terser.minify(code, options)
		return parsed.code
	}

	return code
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
		data = safeAnimDefScope(id, data.toString())
		toolbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-toolbar_, .ant-window_[data-id="${id}"] .win-caption-toolbar_ {${data}}`, options)
		toolbar_output = toolbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}

	cssFile = getMetaValue(meta, "statusbar-style")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		data = safeAnimDefScope(id, data.toString())
		statusbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-status-bar_ {${data}}`, options)
		statusbar_output = statusbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/${namespace}/${id}`)
			.replace(/\t|\n/g, "")
	}

	cssFile = getMetaValue(meta, "dialog-style")
	filePath = cssFile ? FS.path.join(appPath, cssFile) : ""
	if (cssFile && await FS.fileExists(filePath)) {
		data = await FS.readFile(filePath)
		data = safeAnimDefScope(id, data.toString())
		dialog_output = await less.render(`.ant-window_[data-id="${id}"] .dialog_ {${data}}`, options)
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
		data = safeAnimDefScope(id, data)
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

		let importFile = async (baseDir, importStr, exclude) => {
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


// ** Builds def-ant application
const Build = options => {
	let destDir = options.destination

	return new Promise(async (resolve, reject) => {
		let parsed = FS.path.parse(destDir)
		if (!parsed.ext && await FS.fileExists(destDir)) {
			// first clean up
			await FS.deleteDir(destDir)
		}

		let appXml = await FS.readFile(`${options.source}/index.xml`)
		appXml = appXml.toString()
		appXml = appXml.replace(/<Application/, `<Application mDate="${Date.now()}"`)
		appXml = appXml.replace(/\t|\n/g, "")

		let appJson = convert.xml2json(appXml, { compact: true })
		let appXmlDom = JSON.parse(appJson)
		let meta = appXmlDom.Application.Head.meta
		let appId = getMetaValue(meta, "id")
		let name = getMetaValue(meta, "title")
		let version = getMetaValue(meta, "title", "version")
		let buildInclude = (getMetaValue(meta, "build", "include") || "").split(",")
		let namespace = getMetaValue(meta, "author", "namespace")
		let author = getMetaValue(meta, "author")
		let license = getMetaValue(meta, "license")
		let oauth = getMetaValue(meta, "oauth")

		// perform build tasks - if any
		await buildTasks(appXmlDom, options.source, appId, namespace, options.uglify)

		let scriptCompiled = await compileScript(meta, options.source, options.uglify) || ""
		let styleCompiled = await compileStyle(meta, options.source) || ""
		let xslCompiled = await compileXsl(meta, options.source) || ""
		let contentStores = await getContentStores(meta, options.source, options.uglify) || ""
		let contentCompiled = await compileContent(meta, options.source, options.uglify) || ""
		let iconsCompiled = await compileIcons(meta, options.source) || ""

		let regexp = /@import ['"](.+?)['"]/mg
		let imports = appXml.match(regexp) || []
		await Promise.all(imports.map(async item => {
			let importPath = FS.path.join(options.source, item.slice(9,-1))
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
		if (options.uglify) appXml = appXml.replace(/\n|\t/g, "")

		// create destination dir, if it doesnt exist
		if (!parsed.ext && !await FS.fileExists(destDir)) {
			await FS.mkDir(destDir)
		}
		let destFile = FS.path.join(destDir, parsed.ext ? "" : "index.xml")
		await FS.writeFile(destFile, appXml)

		// copy public folder fontent
		let srcPublic = FS.path.join(options.source, "public")
		if (await FS.fileExists(srcPublic)) {
			let exclude = { ext: [".psd", ".ai"], size: buildFileLimit }
			
			buildInclude.map(item => {
				let isExt = exclude.ext.indexOf(item)
				if (isExt > -1) exclude.ext.splice(isExt, 1)
			})

			await FS.copyDir(srcPublic, destDir, exclude)
		}
		
		// copy license to public
		let srcLicense = FS.path.join(options.source, "LICENSE")
		if (await FS.fileExists(srcLicense)) {
			let destLicense = FS.path.join(destDir, "LICENSE")
			await FS.copyFile(srcLicense, destLicense)
		}
		
		if (oauth) {
			// copy oauth-file to public, if exist
			let srcOauth = FS.path.join(options.source, oauth)
			if (await FS.fileExists(srcOauth)) {
				let destOauth = FS.path.join(destDir, oauth)
				await FS.copyFile(srcOauth, destOauth)
			} else {
				return reject("Couldn't locate OAuth file: "+ oauth)
			}
		}
		
		let stat = await FS.fileStat(destDir)
		let files = [destFile]
		if (stat.isDirectory()) {
			files = await FS.listDir(destDir)
			files = files.map(f => f.slice(destDir.length + 1))
		}

		let size = appXml.length

		if (options.compress) {
			// compress files
			let JSZip = require("jszip")()
			await Promise.all(files.map(async entry => {
				if (oauth && entry === oauth) return
				let filePath = FS.path.join(destDir, entry)

				if (entry === "icon.svg") {
					// update application icon
					let iconPath = FS.path.join(destDir, entry)
					let file = await FS.readFile(iconPath)
					let icon = file.toString()
					let info = ` xmlns="http://www.w3.org/2000/svg" ns="${namespace}" id="${appId}" name="${name}" author="${author}" version="${version}" size="${size}" license="${license}" mStamp="${Math.round(stat.birthtimeMs)}"`
					icon = icon
							.replace(' xmlns="http://www.w3.org/2000/svg"', info)
							.replace(/ {2,}/g, " ")
							.replace(/\t/g, "")
					// write icon updates to build folder
					await FS.writeFile(iconPath, icon)
				}

				let fileData = await FS.readFile(filePath)

				return JSZip.file(entry, fileData)
			}))

			// generate zip file
			let buffer = await JSZip.generateAsync({
				type: "nodebuffer",
				compression: "DEFLATE",
				compressionOptions: { level: 9 },
				mimetype: "application/defiant-x",
			})
			size = buffer.length

			// write to disk
			let zipDest = FS.path.join(destDir, appId +".app")
			await FS.writeFile(zipDest, buffer)

			// clean up build files + folders
			let folders = []
			await Promise.all(files.map(async entry => {
				let rootFiles = ["icon.svg"]
				if (oauth) rootFiles.push(oauth)

				if (rootFiles.includes(entry)) {
					let iconPath = FS.path.join(destDir, entry)
					let file = await FS.readFile(iconPath)
					await FS.writeFile(iconPath, file)
				} else if (entry.includes("/")) {
					let name = entry.slice(0, entry.lastIndexOf("/"))
					if (!folders.includes(name)) {
						folders.push(name)
						await FS.deleteDir(FS.path.join(destDir, name))
					}
				} else {
					await FS.unlink(FS.path.join(destDir, entry))
				}
			}))
		}

		let buildInfo = {
			version,
			name,
			size,
			namespace,
			id: appId,
			uglified: options.uglify || false,
			buildPath: destDir,
			buildDir: destDir.slice(process.cwd().length + 1),
			files,
		}

		let runRequires = meta.find(item => item && item._attributes.name === "requires")
		if (runRequires) {
			buildInfo.runRequires = {}
			runRequires.entry.map(item =>
				buildInfo.runRequires[item._attributes.id] = item._attributes.description)
		}

		resolve(buildInfo)
	})
}


module.exports = {
	Build,
}
