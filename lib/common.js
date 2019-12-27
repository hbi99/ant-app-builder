
const fs = require("fs")
const path = require("path")
const util = require("util")


const FS = {
	org: fs,
	path: path,
	mkdir: util.promisify(fs.mkdir),
	readFile: util.promisify(fs.readFile),
	writeFile: util.promisify(fs.writeFile),
	fileExists: util.promisify(fs.exists),
	fileStat: util.promisify(fs.stat),
	copyFile: util.promisify(fs.copyFile),
}

module.exports = {
	FS,
}
