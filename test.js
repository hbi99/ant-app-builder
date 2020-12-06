
const path = require("path")
const { Build } = require("./lib/")

let source = path.join(__dirname, "temp/solitaire")
let destination = path.join(__dirname, "temp/_build")
let uglify = false
let compress = true

let runIt = async () => {
	let b = await Build({ source, destination, uglify, compress })
	// console.log(b)
}
runIt()

