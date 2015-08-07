
if (!process.argv[2]) throw new Error("Must sepcify program descriptor path argument!");
process.env.PINF_PROGRAM_PATH = require("path").resolve(process.argv[2]);


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

	const SPAWN = require("child_process").spawn;
	const COLORS = require("colors");
	COLORS.setTheme({
	    error: 'red'
	});

	console.log("Hoist config:", JSON.stringify(API.config, null, 4));


	var targetBaseUriPath = API.config.target.path;
	var targetBaseFsPath = targetBaseUriPath;
	if (API.config.target.id) {
		targetBaseFsPath = API.PATH.join(targetBaseFsPath, API.config.target.id);
	}

	var processId = "sm.hoist:" + API.CRYPTO.createHash('sha1').update(__dirname + ":" + API.config.source.server.cwd).digest('hex');

	function start () {

		return API.Q.denodeify(function (callback) {

			if (!API.config.source.server) return callback(null);

			API.console.verbose("Start Server: " + processId);

			var env = {};
			for (var name in process.env) {
				env[name] = process.env[name];
			}
			if (API.config.source.server.env) {
				for (var name in API.config.source.server.env) {
					env[name] = API.config.source.server.env[name];
				}
			}

			API.PM2.connect(function (err) {
			  if (err) return callback(err);

			  API.PM2.delete(processId, function (err) {
			  	// @ignore err

			  	  var args = {
				  	exec_interpreter: null,
				    script: API.config.source.server.run,
				    cwd: API.config.source.server.cwd,
				    name: processId,
				    exec_mode: "fork_mode",
				    instances: 1,
				    env: env
			  	  };
			  	  args.exec_interpreter = API.config.source.server.runInterpreter || "bash";
			  	  if (args.exec_interpreter === "node") {
			  	  	args.exec_interpreter = process.env._SM_HOIST_EXEC_INTERPRETER_NODE;
			  	  }
			  	  API.console.debug("Process args:", args);
				  API.PM2.start(args, function (err, apps) {
				  	if (err) return callback(err);


				    API.PM2.disconnect();
					if (API.config.source.server.wait) {
		    			var cb = callback;
		    			setTimeout(function () {

							API.console.verbose("Started Server: " + processId);

		    				cb(null);
		    			}, parseInt(API.config.source.server.wait) * 1000);
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

		return API.Q.fcall(function () {

			if (!API.config.source.server) return callback(null);
			if (!API.config.source.server.host) return callback(null);
			if (!API.config.pages) return callback(null);

			function fetchUrl (url) {
				return API.Q.denodeify(function (callback) {
					return API.REQUEST({
						uri: url
					}, function (err, response, body) {
						if (err) return callback(err);
						if (response.statusCode !== 200) {
							var err = new Error("Got status '" + response.statusCode + "' while fetching '" + url + "'");
							err.code = response.statusCode;
							return callback(err);
						}
						return callback(null, body);
					});
				})();
			}

			function downloadUrl (url, path) {
				return API.Q.denodeify(function (callback) {

					var request = API.REQUEST.get(url);
					request.pause();
					request.on('error', function (err) {
						if (!callback) return;
						callback(err);
						callback = null;
					});
					request.on('response', function (resp) {
						if (resp.statusCode !== 200) {
							if (!callback) return;
							callback(null, resp.statusCode);
							callback = null;
							return;
						}
						var stream = API.FS.createWriteStream(path);
						stream.on("close", function () {
							if (!callback) return;
							callback(null, resp.statusCode);
							callback = null;
							return;
						});
						request.pipe(stream);
						request.resume();
					});						
				})();
			}

			function parseHtml (url, html) {

                API.console.verbose("html", html);

				function parse (loaded, window, declarations) {

                    const $ = window.jQuery;

                    API.console.verbose("loaded", loaded);

                    $('[component\\3Aid]').each(function () {

                    	var tag = $(this);

						var attrs = {};
						$.each(this.attributes, function () {
							if(this.specified) {
								attrs[this.name] = (""+this.value).replace(/(^\s+|\s+$)/g, "");
							}
						});

                    	var id = attrs["component:id"];
                    	delete attrs["component:id"];

                    	declarations.components[id] = {
                    		tag: tag.prop("tagName"),
                    		attributes: attrs,
                    		innerHTML: tag.html()
                    	};
                    });

                    if (Object.keys(declarations.components).length === 0) return;

                    $('LINK[rel="stylesheet"]').each(function () {

                    	var tag = $(this);

						var attrs = {};
						$.each(this.attributes, function () {
							if(this.specified) {
								attrs[this.name] = this.value;
							}
						});

						declarations.resources.push({
                    		tag: tag.prop("tagName"),
                    		attributes: attrs
						});
                    });

                    $('SCRIPT[src]').each(function () {

                    	var tag = $(this);

						var attrs = {};
						$.each(this.attributes, function () {
							if(this.specified) {
								attrs[this.name] = this.value;
							}
						});

						// We ignore scripts inserted by jsdom
						if (attrs.class === "jsdom") return;

						declarations.resources.push({
                    		tag: tag.prop("tagName"),
                    		attributes: attrs
						});
                    });

                    $('IMG[src]').each(function () {

                    	var tag = $(this);

						var attrs = {};
						$.each(this.attributes, function () {
							if(this.specified) {
								attrs[this.name] = this.value;
							}
						});

						declarations.resources.push({
                    		tag: tag.prop("tagName"),
                    		attributes: attrs
						});
                    });
				}

				return API.Q.denodeify(function (callback) {

					var virtualConsole = API.JSDOM.createVirtualConsole();
					virtualConsole.on("jsdomError", function (error) {
						console.error(error.message, error.detail);
					});

					var loaded = [];

			        return API.JSDOM.env({
			        	url: url,
			        	scripts: [
	                    	'file://' + require.resolve("jquery/dist/jquery.js")
                    	],
                    	features: {
							FetchExternalResources: ["script", "frame", "iframe", "link"],
							ProcessExternalResources: ["script"]
						},
                    	resourceLoader: function (resource, callback) {
							if (resource.url.host) {
								loaded.push(resource.url.path);
							}
							resource.defaultFetch(callback);
						},
						done: function (err, window) {
		                	if (err) return callback(err);

							window.addEventListener("error", function (event) {
								console.error("script error!!", event.error);
							});

		                	try {
			                    const $ = window.jQuery;

		                        var declarations = {
		                        	resources: [],
		                        	components: {}
		                        };

								$(function () {

			                        parse(loaded, window, declarations);

			                        return callback(null, declarations);
								});

		                    } catch (err) {
		                    	err.message += " (while parsing html from '" + url + "')";
		                    	err.stack += "\n(while parsing html from '" + url + "')";
		                    	return callback(err);
		                    }
			            }
			        });
	            })();
			}

			function exportResources (baseUrl, declarations) {

				var baseUrlParsed = API.URL.parse(baseUrl);

				var basePath = API.PATH.join(targetBaseFsPath, "resources");

				var filesMoved = {};
				function getFileStorageHandlerForUrl (url, basePath, subPath) {

					var urlParsed = API.URL.parse(url);
					var localPath = API.PATH.join(basePath, subPath, urlParsed.pathname.substring(1).replace(/\//g, "~"));

					function ensureDirectories () {
						return API.QFS.exists(API.PATH.dirname(localPath)).then(function (exists) {
							if (exists) return;
							return API.QFS.makeTree(API.PATH.dirname(localPath));
						});
					}

					return ensureDirectories().then(function () {

						return {
							downloadPath: localPath,
							onDownloaded: function () {
								if (!filesMoved[localPath]) {
									filesMoved[localPath] = API.QFS.read(localPath).then(function (data) {

										var path = localPath.split(".");
										var ext = path.pop();
										path = path.join(".");

										path += "-" + API.CRYPTO.createHash("sha1").update(data).digest("hex").substring(0, 7);
										path += "." + ext;

										return API.QFS.exists(path).then(function (exists) {
											if (exists) {
												return API.QFS.exists(localPath).then(function (exists) {
													if (exists) {
														return API.QFS.remove(localPath);
													}
												});
											}
											return API.QFS.move(localPath, path);
										}).then(function () {
											return {
												relpath: "/" + API.PATH.relative(targetBaseUriPath, path),
												realpath: path
											};
										});
									});
								}
								return filesMoved[localPath];
							}
						};
					});
				}

				function ensureDirectories () {
					return API.QFS.exists(basePath).then(function (exists) {
						if (exists) return;
						return API.QFS.makeTree(basePath);
					});
				}

				var rewrites = [];

				return ensureDirectories().then(function () {

					return API.Q.all(declarations.resources.map(function (resource) {

						if (
							resource.tag === "LINK" &&
							resource.attributes.rel === "stylesheet"
						) {

							var url = "http://" + API.config.source.server.host + resource.attributes.href;

							API.console.verbose("Fetch resource '" + url + "' so we can export it");

							return fetchUrl(url).then(function (css) {

								// https://github.com/jakubpawlowicz/clean-css
								// https://github.com/Automattic/juice

								var targetFilename = API.CRYPTO.createHash("sha1").update(
									resource.attributes.href
								).digest("hex");

								var targetPath = API.PATH.join(basePath, targetFilename + ".css");

								resource.exportPath = targetPath;
								resource.attributes.href =  "/" + API.PATH.relative(targetBaseUriPath, targetPath);

								function parseUrls (css) {

									var urls = {};

									var output = API.REWORK(css, {
										source: targetPath
									})
									.use(API.REWORK_PLUGIN_URL(function(url) {

										var sourceUrl = url;

										if (/^(\/|\.)/.test(sourceUrl)) {
											// Only process URLs pointing to our server.

											// Get source URL and ensure it is valid
											var sourceUrl = API.PATH.join(baseUrl, url).replace(/^http:\//, "http://");
											var sourceUrlParsed = API.URL.parse(sourceUrl);
											if (sourceUrlParsed.host !== baseUrlParsed.host) {
												// The host has changed after normalizing the path
												// so we assume it is an invalud URL
												sourceUrl = "";
											}

											urls[url] = {
												sourceUrl: sourceUrl
											};
										}

										return url;
									}));

									return API.Q.resolve(urls);
								}

								function downloadUrls (urls) {
									return API.Q.all(Object.keys(urls).filter(function (id) {
										return (!!urls[id].sourceUrl);
									}).map(function (id) {

										return getFileStorageHandlerForUrl(urls[id].sourceUrl, basePath, "assets").then(function (handler) {

											return downloadUrl(urls[id].sourceUrl, handler.downloadPath).then(function (status) {

												if (status !== 200) {
													urls[id].relpath = "/404?url=" + urls[id].sourceUrl;
													return;
												}

												return handler.onDownloaded().then(function (info) {
													urls[id].relpath = info.relpath;
												});
											});
										});
									})).then(function () {
										return urls;
									});
								}

								function processCss (css, urls) {
									return API.Q.resolve(
										API.REWORK(css, {
											source: targetPath
										})
										.use(API.REWORK_PLUGIN_URL(function(url) {
											var sourceUrl = url;
											if (/^(\/|\.)/.test(sourceUrl)) {
												// Only process URLs pointing to our server.
												return urls[sourceUrl].relpath;
											}
											return sourceUrl;
										}))
										.toString({
											sourcemap: false
										})
									);
								}

								return parseUrls(css).then(function (urls) {

									return downloadUrls(urls).then(function (urls) {

										return processCss(css, urls).then(function (css) {

											return API.QFS.write(targetPath, css);
										});
									});
								});
							});

						} else
						if (
							resource.tag === "IMG" ||
							resource.tag === "SCRIPT"
						) {

							var sourceUrl = "http://" + API.PATH.join(API.config.source.server.host, resource.attributes.src);

							API.console.verbose("Fetch resource '" + sourceUrl + "' so we can export it");

							return getFileStorageHandlerForUrl(
								sourceUrl,
								basePath,
								( resource.tag === "SCRIPT" ? "" : "assets" )
							).then(function (handler) {

								return downloadUrl(sourceUrl, handler.downloadPath).then(function (status) {

									function finalize (info) {

										if (resource.tag === "SCRIPT") {
											rewrites.push({
												from: new RegExp('(<\\s*script.*?\\ssrc\\s*=\\s*[\'"]{1})' + API.REGEXP_ESCAPE(resource.attributes.src) + '([\'"]{1}.+?<\\s*\\/\\s*script\\s*>)', 'g'),
												to: ""
											});
										} else {
											rewrites.push({
												from: new RegExp('(src\\s*=\\s*[\'"]{1})' + API.REGEXP_ESCAPE(resource.attributes.src) + '([\'"]{1})', 'g'),
												to: "$1" + info.relpath + "$2"
											});
										}

										resource.attributes.src = info.relpath;
										resource.exportPath = info.realpath;
									}

									if (status !== 200) {
										finalize({
											relpath: "404?url=" + sourceUrl,
											realpath: ""
										});
										return;
									}

									return handler.onDownloaded().then(finalize);
								});
							});

						} else {
							console.error("resource", resource);
							throw new Error("Don't know how to export resource");
						}
					}));
				}).then(function () {
					return rewrites;
				});
			}

			function exportComponents (componentGroupAlias, declarations, rewrites) {

				var basePath = API.PATH.join(targetBaseFsPath, "components", componentGroupAlias);

				function ensureDirectories () {
					return API.QFS.exists(basePath).then(function (exists) {
						if (exists) return;
						return API.QFS.makeTree(basePath);
					});
				}

				function generateHtml (component) {
					var html = [];
					html.push('<!DOCTYPE HTML>');
					html.push('<html>');
					html.push('  <head>');
					declarations.resources.forEach(function (resource) {
						if (resource.tag !== "LINK") return;
						html.push('    <link rel="stylesheet" href="' + resource.attributes.href + '">');
					});
					html.push('  </head>');
					if (component.tag !== "BODY") html.push('  <body>');

					var attrs = Object.keys(component.attributes).map(function (name) {
						return name + '="' + component.attributes[name].replace(/"/g, '\\"') + '"';
					});
					attrs = ((attrs.length > 0)? (" " + attrs.join(" ")) : "");
					html.push('    <' + component.tag.toLowerCase() + attrs + '>');

					var impl = component.innerHTML;
					rewrites.forEach(function (rewrite) {
						impl = impl.replace(rewrite.from, rewrite.to);
					});
					html.push(impl);

					html.push('    </' + component.tag.toLowerCase() + '>');
					if (component.tag !== "BODY") html.push('  </body>');

					declarations.resources.forEach(function (resource) {
						if (resource.tag !== "SCRIPT") return;
						html.push('    <script src="' + resource.attributes.src + '"></script>');
					});

					html.push('</html>');

					return html.join("\n");
				}

				return ensureDirectories().then(function () {

					return API.Q.all(Object.keys(declarations.components).map(function (alias) {

						var targetPath = API.PATH.join(basePath, alias + ".htm");

						declarations.components[alias].exportPath = targetPath;

						// https://github.com/pocketjoso/penthouse

						return API.QFS.write(targetPath, generateHtml(declarations.components[alias]));
					}));
				}).then(function () {
					return basePath;
				});
			}

			var pages = {};
			return API.Q.all(Object.keys(API.config.pages).map(function (alias) {

				var url = "http://" + API.config.source.server.host + API.config.pages[alias].source;

				API.console.verbose("Fetch '" + url + "'");

				return fetchUrl(url).then(function (html) {

					return parseHtml(url, html).then(function (declarations) {

						return exportResources(API.PATH.dirname(url), declarations).then(function (rewrites) {

							return exportComponents(alias, declarations, rewrites).then(function (basePath) {

								pages[alias] = declarations;

								var defintionPath = basePath + ".json";

								return API.QFS.write(defintionPath, JSON.stringify(declarations, null, 4));
							});
						});
					});
				});
			})).then(function () {
				return pages;
			});
		});
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

			if (API.config.viewer.bind) {
				server.listen(parseInt(API.config.viewer.port), API.config.viewer.bind);
				console.log("Viewer available at http://" + API.config.viewer.bind + ":" + API.config.viewer.port + "/");
			} else {
				server.listen(parseInt(API.config.viewer.port));
				console.log("Viewer available at http://localhost:" + API.config.viewer.port + "/");
			}
		});
	}

	function build () {

		if (!API.OPTIMIST.argv.build) {
			return API.Q.resolve();
		}

		function writeDescriptorFile (pageDefinitions) {

			var descriptor = {
				pages: {}
			};

			Object.keys(pageDefinitions).forEach(function (pageAlias) {

				var declarations = pageDefinitions[pageAlias];

				descriptor.pages[pageAlias] = {
					"resources": [],
					"componentsDescriptorPath": "{{__DIRNAME__}}/components/" + pageAlias + ".json",
					"components": {}
				};

				declarations.resources.forEach(function (resource) {
					if (
						resource.tag === "LINK" &&
						resource.attributes.rel === "stylesheet"
					) {
						descriptor.pages[pageAlias].resources.push({
							"type": "css",
							"uriPath": resource.attributes.href,
							"fsPath": "{{__DIRNAME__}}/" + API.PATH.relative(
								targetBaseFsPath,
								resource.exportPath
							)
						});
					} else
					if (resource.tag === "SCRIPT") {
						descriptor.pages[pageAlias].resources.push({
							"type": "js",
							"uriPath": resource.attributes.src,
							"fsPath": "{{__DIRNAME__}}/" + API.PATH.relative(
								targetBaseFsPath,
								resource.exportPath
							)
						});
					}
				});

				Object.keys(declarations.components).forEach(function (componentAlias) {
					descriptor.pages[pageAlias].components[componentAlias] = {
						"uriHtmlPath": "/" + API.PATH.relative(
							targetBaseUriPath,
							declarations.components[componentAlias].exportPath
						),
						"fsHtmlPath": "{{__DIRNAME__}}/" + API.PATH.relative(
							targetBaseFsPath,
							declarations.components[componentAlias].exportPath
						)
					};
				});
			});

			return API.QFS.write(
				API.PATH.join(targetBaseFsPath, "hoisted.json"),
				JSON.stringify(descriptor, null, 4)
			);
		}

		return start().then(function () {

			return parsePages().then(function (pageDefinitions) {

				API.console.verbose("Page definitions:", JSON.stringify(pageDefinitions, null, 4));

				return writeDescriptorFile(pageDefinitions);
			});

		}).then(function () {
			return stop();
		});

	}

	function spin () {
		// TODO: Trigger build if it is out of date (check source file timestamps)

		if (!API.OPTIMIST.argv.spin) {
			return API.Q.resolve();
		}

		return startViewer();
	}

	return build().then(function () {

		return spin();
	}).fail(function (err) {
		console.error("ERROR", err.stack || err);
		throw err;
	});

});
