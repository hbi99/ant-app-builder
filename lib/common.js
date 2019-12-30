
const fs = require("fs")
const path = require("path")
const util = require("util")


const copyDir = async (src, dest, exclude) => {
	let list = await FS.readDir(src)
	if (exclude) {
		// exclude files 
		list = await Promise.all(list.map(async f => {
			let fPath = FS.path.join(src, f)
			let parsed = await FS.path.parse(fPath)
			let stat = await FS.fileStat(fPath)
			let check = exclude.ext && exclude.ext.indexOf(parsed.ext) > -1
							|| (exclude.size && stat.size > exclude.size)
			return check ? false : f
		}))
	}
	// filter non-files
	list = list.filter(f => f && !f.startsWith("."))

	await Promise.all(list.map(async file => {
			let fSrc = FS.path.join(src, file)
			let fDest = FS.path.join(dest, file)
			let exists = await FS.fileExists(fDest)
			let stat = await FS.fileStat(fSrc)

			if (stat.isDirectory()) {
				if (!exists) await FS.mkDir(fDest)
				await copyDir(fSrc, fDest, exclude)
			} else {
				await FS.copyFile(fSrc, fDest)
		 	}
		}))
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

const pMkdir = util.promisify(fs.mkdir)
const mkDir = async (dir) => pMkdir(dir, { recursive: true })

const FS = {
	org: fs,
	path,
	mkDir,
	rmdir: util.promisify(fs.rmdir),
	unlink: util.promisify(fs.unlink),
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
