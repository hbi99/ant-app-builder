
const path = require("path")
const { Build } = require("./lib/")

let source = path.join(__dirname, "temp/solitaire")
let destination = path.join(__dirname, "temp/_build")
let uglify = false
let compress = true

let runIt = async () => {
	Build({ source, destination, uglify, compress })
		.then(success => console.log("Done!"))
		.catch(e => console.log(e))
}
runIt()

