
const path = require("path")
const { Build } = require("./lib/")

let srcDir = path.join(__dirname, "temp/finder")
let destDir = path.join(__dirname, "temp/_build")
let uglify = true

let runIt = async() => {
	let b = await Build(srcDir, destDir, uglify)
	console.log(b)
}

runIt()
