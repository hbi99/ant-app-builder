
const path = require("path")
const { Build } = require("./lib/")

let srcDir = path.join(__dirname, "temp/solitaire")
let destDir = path.join(__dirname, "temp/_build")
let uglify = false

let runIt = async () => {
	let b = await Build(srcDir, destDir, uglify)
	// console.log(b)
}
runIt()

