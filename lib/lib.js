
module.exports = {
    DEBUG: false,
    VERBOSE: false,
    console: {
    	log: function () {
    		var args = Array.prototype.slice.call(arguments);
    		console.log.call(console, "log", args);
    	},
    	error: function () {
    		var args = Array.prototype.slice.call(arguments);
    		console.log.call(console, "error", args);
    	},
    	warn: function () {
    		if (!module.exports.VERBOSE) return;
    		var args = Array.prototype.slice.call(arguments);
    		console.log.call(console, "info", args);
    	},
    	verbose: function () {
    		if (!module.exports.VERBOSE) return;
    		var args = Array.prototype.slice.call(arguments);
    		console.log.call(console, "info", args);
    	},
    	debug: function () {
    		if (!module.exports.DEBUG) return;
    		var args = Array.prototype.slice.call(arguments);
    		console.log.call(console, "debug", args);
    	}
    },
    "Q": require("q"),
    "QFS": require("q-io/fs"),
    "PM2": require("pm2"),
    "CRYPTO": require("crypto"),
    "FS": require("fs"),
    "PATH": require("path"),
    "JSDOM": require("jsdom"),
    "REQUEST": require("request"),
    "CJSON": require("canonical-json"),
    "REWORK": require("rework"),
    "REWORK_PLUGIN_URL": require("rework-plugin-url"),
    "URL": require("url"),
    "OPTIMIST": require("optimist"),
    "HTTP": require("http"),
    "EXPRESS": require("express"),
    "SEND": require("send"),
    "REGEXP_ESCAPE": require("escape-regexp-component")
};
