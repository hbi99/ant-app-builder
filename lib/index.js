
const btoa = require("btoa")
const convert = require("xml-js")
const less = require("less")
const rollup = require("rollup")
const terser = require("terser")

const { FS } = require("./common")


// ** Get meta values from application <Head>
const getMetaValue = (meta, name, attr) => {
	const m = meta.find(item => item && item._attributes.name === name)
	return m ? m._attributes[attr || "value"] || m : false
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
	const parsed = terser.minify(code, { compress: true })
	
	return uglify ? parsed.code : code
}

// ** Compiles styles (less files)
const compileStyle = async (meta, appPath) => {
	const id = getMetaValue(meta, "id")
	let isHeadless = getMetaValue(meta, "headless")
	let filePath = FS.path.join(appPath, getMetaValue(meta, "style", "toolbar"))
	let options = { compress: true }
	let toolbar_output = ""
	let winbody_output = ""
	let statusbar_output = ""

	if (await FS.fileExists(filePath)) {
		const data = await FS.readFile(filePath)
		toolbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-toolbar_ {${data.toString()}}`, options)
		toolbar_output = toolbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/ant/${id}`)
			.replace(/\t|\n/g, "")
	}

	filePath = FS.path.join(appPath, getMetaValue(meta, "style", "statusbar"))
	if (await FS.fileExists(filePath)) {
		const data = await FS.readFile(filePath)
		statusbar_output = await less.render(`.ant-window_[data-id="${id}"] .win-status-bar_ {${data.toString()}}`, options)
		statusbar_output = statusbar_output.css
			.replace(/(url\('?)\~/g, `$1/app/ant/${id}`)
			.replace(/\t|\n/g, "")
	}

	filePath = FS.path.join(appPath, getMetaValue(meta, "style"))
	if (await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		let dirPath = FS.path.dirname(filePath)
		data = data.toString().replace(/(@import ")/g, `$1${dirPath}/`)
		winbody_output = await less.render(`.ant-window_[data-id="${id}"] ${isHeadless ? "": ".window-body_"} {${data}}`, options)
		winbody_output = winbody_output.css
			.replace(/(url\('?)\~/g, `$1/app/ant/${id}`)
			.replace(/\t|\n/g, "")
	}
	return toolbar_output + winbody_output + statusbar_output
}

// ** Compiles xsl
async function compileXsl(meta, appPath) {
	const filePath = FS.path.join(appPath, getMetaValue(meta, "xsl"))

	if (await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString().replace(/\t|\n/g, "")
		return data
	}
}

// ** Compiles content
async function compileContent(meta, appPath, uglify) {
	const id = getMetaValue(meta, "id")
	const filePath = FS.path.join(appPath, getMetaValue(meta, "content"))
	const dirPath = FS.path.dirname(filePath)

	if (await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString()
				.replace(/(url\('?)\~/g, `$1/app/ant/${id}`)

		let regexp = /@import ['"](.+?)['"]/mg
		let imports = data.match(regexp) || []

		await Promise.all(imports.map(async item => {
			const importPath = FS.path.join(dirPath, item.slice(9,-1))
			const importFile = await FS.readFile(importPath)
			const rx = new RegExp(item, "im")
			data = data.replace(rx, importFile)
		}))

		return uglify ? data.replace(/\n|\t/g, "") : data
	}
}

// ** Compiles svg icons
async function compileIcons(meta, appPath) {
	const filePath = FS.path.join(appPath, getMetaValue(meta, "icons"))

	if (await FS.fileExists(filePath)) {
		let data = await FS.readFile(filePath)
		data = data.toString().replace(/\t|\n/g, "")
		return data
	}
}

// ** Builds def-ant application
const Build = (srcDir, destDir, uglify) => {
	return new Promise(async (resolve, reject) => {
		let appXml = await FS.readFile(`${srcDir}/index.xml`)
		appXml = appXml.toString()
		appXml = appXml.replace(/\t|\n/g, "")

		const appJson = convert.xml2json(appXml, { compact: true })
		const meta = JSON.parse(appJson).Application.Head.meta
		const appVersion = getMetaValue(meta, "title", "version")
		
		let scriptCompiled = await compileScript(meta, srcDir, uglify) || ""
		let styleCompiled = await compileStyle(meta, srcDir) || ""
		let xslCompiled = await compileXsl(meta, srcDir) || ""
		let contentCompiled = await compileContent(meta, srcDir, uglify) || ""
		let iconsCompiled = await compileIcons(meta, srcDir) || ""

		let regexp = /@import ['"](.+?)['"]/mg
		let imports = appXml.match(regexp) || []
		await Promise.all(imports.map(async item => {
			const importPath = FS.path.join(srcDir, item.slice(9,-1))
			const importFile = await FS.readFile(importPath)
			const rx = new RegExp(item, "im")
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
		if (!await FS.fileExists(destDir)) {
			await FS.mkdir(destDir)
		}
		let destFile = FS.path.join(destDir, "index.xml")
		await FS.writeFile(destFile, appXml)

		// copy app icon
		let src = FS.path.join(srcDir, "public/icon.svg")
		let dest = FS.path.join(destDir, "icon.svg")
		await FS.copyFile(src, dest)

		resolve()
	})
}

module.exports = {
	Build,
}
