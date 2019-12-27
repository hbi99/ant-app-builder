
const path = require("path")
const { Build } = require("./lib/")

let srcDir = path.join(__dirname, "temp/finder")
let destDir = path.join(__dirname, "temp/_build")
let uglify = false

Build(srcDir, destDir, uglify)
