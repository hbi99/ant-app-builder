
const fs = require("fs")
const path = require("path")
const util = require("util")


const copyDir = async (src, dest) => {
	let list = await FS.readDir(src)

	list.filter(f => !f.startsWith("."))
		.map(async file => {
			let fSrc = FS.path.join(src, file)
			let fDest = FS.path.join(dest, file)
			let exists = await FS.fileExists(fDest)
			let stat = await FS.fileStat(fSrc)

			if (stat.isDirectory()) {
				if (!exists) await FS.mkdir(fDest)
				await copyDir(fSrc, fDest)
			} else {
				await FS.copyFile(fSrc, fDest)
		 	}
		})
}

const deleteDir = async (dir) => {
	let list = await FS.readDir(dir)

	await Promise.all(list.map(async file => {
			let fPath = FS.path.join(dir, file)
			let stat = await FS.fileStat(fPath)

			if (stat.isDirectory()) {
				await deleteDir(fPath)
			} else {
				await FS.unlink(fPath)
		 	}
		}))
	
	await FS.rmdir(dir)
}

const listDir = async (dir) => {
	let ret = []
	let list = await FS.readDir(dir)
	list = list.filter(f => !f.startsWith("."))

	await Promise.all(list.map(async file => {
			let fPath = FS.path.join(dir, file)
			let stat = await FS.fileStat(fPath)

			if (stat.isDirectory()) {
				let sub = await listDir(fPath)
				ret = ret.concat(sub)
			} else {
				ret.push(fPath)
		 	}
		}))

	return ret
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
	listDir,
	copyDir,
	deleteDir,
}

module.exports = {
	FS,
}
