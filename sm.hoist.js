

if (require.main === module) {
	if (!process.argv[2]) throw new Error("Must sepcify program descriptor path argument!");
	process.env.PINF_PROGRAM_PATH = require("path").resolve(process.argv[2]);
}


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

	const SPAWN = require("child_process").spawn;
	const COLORS = require("colors");
	COLORS.setTheme({
	    error: 'red'
	});
	const EXPORT = require("./lib/export").forLib(API);

	console.log("Hoist config:", JSON.stringify(API.config, null, 4));


	exports.hoist = function (options) {

		options.spin = options.spin || false;
		options.build = options.build || false;
		options.uri = options.uri || null;

		var targetBaseUriPath = options.config.target.path;
		var targetBaseFsPath = targetBaseUriPath;
		if (options.config.target.id) {
			targetBaseFsPath = API.PATH.join(targetBaseFsPath, options.config.target.id);
		}

		var processId = "sm.hoist:" + API.CRYPTO.createHash('sha1').update(__dirname + ":" + options.config.source.server.cwd).digest('hex');

		function start () {
	
			return API.Q.denodeify(function (callback) {
	
				if (!options.config.source.server.run) return callback(null);
	
				API.console.verbose("Start Server: " + processId);
	
				var env = {};
				for (var name in process.env) {
					env[name] = process.env[name];
				}
				if (options.config.source.server.env) {
					for (var name in options.config.source.server.env) {
						env[name] = options.config.source.server.env[name];
					}
				}
	
				API.PM2.connect(function (err) {
				  if (err) return callback(err);
	
				  API.PM2.delete(processId, function (err) {
				  	// @ignore err
	
				  	  var args = {
					  	exec_interpreter: null,
					    script: options.config.source.server.run,
					    cwd: options.config.source.server.cwd,
					    name: processId,
					    exec_mode: "fork_mode",
					    instances: 1,
					    env: env
				  	  };
				  	  args.exec_interpreter = options.config.source.server.runInterpreter || "bash";
				  	  if (args.exec_interpreter === "node") {
				  	  	args.exec_interpreter = process.env._SM_HOIST_EXEC_INTERPRETER_NODE;
				  	  }
				  	  API.console.debug("Process args:", args);
					  API.PM2.start(args, function (err, apps) {
					  	if (err) return callback(err);
	
	
					    API.PM2.disconnect();
						if (options.config.source.server.wait) {
			    			var cb = callback;
			    			setTimeout(function () {
	
								API.console.verbose("Started Server: " + processId);
	
			    				cb(null);
			    			}, parseInt(options.config.source.server.wait) * 3000);
			    		} else {
				    		callback(null);
			    		}
					  });
				  });				  
				
				});
	
			})();
		}
	
		function stop () {
			return API.Q.denodeify(function (callback) {
	
				if (!options.config.source.server.run) return callback(null);
	
				API.console.verbose("Stop Server: " + processId);
				API.PM2.connect(function (err) {
				  if (err) return callback(err);
				  API.PM2.stop(processId, function (err) {
				  	if (err) return callback(err);
					API.console.verbose("Stopped Server: " + processId);
				    API.PM2.disconnect();
				    return callback(null);
				  });
				});
			})();
		}

		function parsePages () {
			return EXPORT.export(options);
		}

		function startViewer () {
			return API.Q.fcall(function () {
	
				var app = API.EXPRESS();
	
				app.get(/^\/favicon\.ico$/, function (req, res, next) {
					res.writeHead(200);
					return res.end();
				});
	
				app.get(/^\/404$/, function (req, res, next) {
					console.log("[Viewer] Url not found: " + req.url);
					res.writeHead(404);
					return res.end();
				});
	
				app.get(/^\/(.*)$/, function (req, res, next) {
	
					var path = req.params[0];
	
					if (path) {
						return API.SEND(req, path, {
							root: targetBaseUriPath
						}).on("error", next).pipe(res);
					}
	
					function buildHomePage () {
	
						var descriptor = require(API.PATH.join(targetBaseFsPath, "hoisted.json"));
	
						var html = [];
	
						html.push('<ul>');
	
						Object.keys(descriptor.pages).forEach(function (pageAlias) {
	
							Object.keys(descriptor.pages[pageAlias].components).forEach(function (componentAlias) {
	
								var component = descriptor.pages[pageAlias].components[componentAlias];
	
								html.push([
									'<li><a href="' + component.uriHtmlPath + '">',
									component.uriHtmlPath
										.replace(/\/components\//, "/")
										.replace(/^(\/|\.htm$)/g, "")
										.replace(/\//g, " > "),
									'</a></li>'
								].join(""));
							});
						});
	
						html.push('</ul>');
	
						return API.Q.resolve(html.join("\n"));
					}
	
					return buildHomePage().then(function (html) {
						res.writeHead(200, {
							"Content-Type": "text/html"
						});
						return res.end(html);
					}, next);
				});
	
				var server = API.HTTP.createServer(app);
	
				if (options.config.viewer.bind) {
					server.listen(parseInt(options.config.viewer.port), options.config.viewer.bind);
					console.log("Viewer available at http://" + options.config.viewer.bind + ":" + options.config.viewer.port + "/");
				} else {
					server.listen(parseInt(options.config.viewer.port));
					console.log("Viewer available at http://localhost:" + options.config.viewer.port + "/");
				}
			});
		}
	
		function build () {
	
			if (!options.build) {
				return API.Q.resolve();
			}

			return start().then(function () {
	
				return parsePages().then(function (descriptor) {
	
					API.console.verbose("Hoisted descriptor:", JSON.stringify(descriptor, null, 4));
				});
	
			}).then(function () {
				return stop();
			});
	
		}
	
		function spin () {
			// TODO: Trigger build if it is out of date (check source file timestamps)
	
			if (!options.spin) {
				return API.Q.resolve();
			}
	
			return startViewer();
		}
	
		return build().then(function () {
	
			return spin();
		});
	}


	if (require.main === module) {
		return exports.hoist({
			spin: API.OPTIMIST.argv.spin || false,
			build: API.OPTIMIST.argv.build || false,
			uri: API.OPTIMIST.argv.uri || null,
			config: API.config
		}).fail(function (err) {
			console.error("ERROR", err.stack || err);
			throw err;
		});
	}
});
