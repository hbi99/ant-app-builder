
const path = require("path")
const { Build, Bundle} = require("./lib/")

let srcDir = path.join(__dirname, "temp/arcad")
let destDir = path.join(__dirname, "temp/_build")
let uglify = false

let runIt = async() => {
	let src = path.join(srcDir, "/src/js/bundle.js")
	await Bundle(src)
	
	//let b = await Build(srcDir, destDir, uglify)
	//console.log(b)
}
runIt()

