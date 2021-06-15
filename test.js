
const path = require("path")
const { Build } = require("./lib/")

let source = path.join(__dirname, "temp/eniac")
let destination = path.join(__dirname, "temp/_build")
let uglify = false
let compress = false

let runIt = async () => {
	Build({ source, destination, uglify, compress })
		.then(build => {
			console.log(build)
			console.log("Done!")
		})
		.catch(e => console.log(e))
}
runIt()

