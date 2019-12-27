
const fs = require("fs")
const path = require("path")
const util = require("util")


const copyRecursive = async (src, dest) => {
	let list = await FS.readDir(src)
	list.filter(f => !f.startsWith("."))
		.map(async file => {
			let fSrc = FS.path.join(src, file)
			let fDest = FS.path.join(dest, file)
			let exists = await FS.fileExists(fSrc)
			let stat = await FS.fileStat(fSrc)

			if (stat.isDirectory()) {
				if (!exists) await FS.mkdir(fDest)
				await copyRecursive(fSrc, fDest)
			} else {
				await FS.copyFile(fSrc, fDest)
		 	}
		})
}

const FS = {
	org: fs,
	path: path,
	mkdir: util.promisify(fs.mkdir),
	readDir: util.promisify(fs.readdir),
	readFile: util.promisify(fs.readFile),
	writeFile: util.promisify(fs.writeFile),
	fileExists: util.promisify(fs.exists),
	fileStat: util.promisify(fs.stat),
	copyFile: util.promisify(fs.copyFile),
	copyRecursive,
}

module.exports = {
	FS,
}
