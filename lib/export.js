
exports.forLib = function (LIB) {
    
    var exports = {};
    
    exports.export = function (options) {

		return LIB.Q.fcall(function () {

			if (!options.config.source.server) {
				throw new Error("No 'source.server' set!");
			}
			if (!options.config.source.server.host) {
				throw new Error("No 'source.server.host' set!");
			}
			if (!options.config.pages) {
				throw new Error("No 'pages' set!");
			}

    		var targetBaseUriPath = options.config.target.path;
    		var targetBaseFsPath = targetBaseUriPath;
    		if (options.config.target.id) {
    			targetBaseFsPath = LIB.PATH.join(targetBaseFsPath, options.config.target.id);
    		}

			var filesDownloading = {};
			var filesMoved = {};

			function fetchUrl (url) {

				function attempt () {
					if (!attempt.count) attempt.count = 0;
					return LIB.Q.denodeify(function (callback) {
						return LIB.REQUEST({
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
					})().fail(function (err) {
						// If we cannot connect at all we assume server is not yet up
						// and keep trying until it works.
						if (err.code === "ECONNREFUSED") {
							console.error("Error: Could not connect to '" + url + "'! See 'pm2 logs'");
							return LIB.Q.delay(1000).then(attempt);
						}
						// If we get a 404 we assume server is not yet up properly as page should be there.
						if (err.code === 404) {
							console.error("Error: Got 404 for '" + url + "'! See 'pm2 logs'");
							return LIB.Q.delay(1000).then(attempt);
						}
						throw err;
					});
				}

				return attempt();
			}

			function downloadUrl (url, path) {
				if (!filesDownloading[url + ":" + path]) {
					filesDownloading[url + ":" + path] = LIB.Q.denodeify(function (callback) {

						console.log("Downloading '" + url + "' to '" + path + "'");

						var request = LIB.REQUEST.get(url);
	//					request.pause();
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
							if (LIB.DEBUG) console.log("response headers for '" + url + "'", resp.headers);
							var stream = LIB.FS.createWriteStream(path, {
								flags: 'w'
							});
							stream.on("finish", function () {
								if (!callback) return;
								console.log("Download of '" + url + "' to '" + path + "' done");
								callback(null, resp.statusCode);
								callback = null;
								return;
							});
							request.pipe(stream);
	//						request.resume();
						});						
					})();
				}
				return filesDownloading[url + ":" + path];
			}

			function parseHtml (url, html) {

                LIB.console.verbose("html", html);

                function parseRawHtml (html, declarations) {

                	var m = null;

                	m = html.match(/^\s*(<!DOCTYPE\s*(.+)\s*>)\s*(?:\n|$)/, html);
                	if (m) {
                		declarations.schemas["DOCTYPE"] = m[2];
                	}
                }

				function parseInstanciatedHtml (loaded, window, declarations) {

                    const $ = window.jQuery;

                    LIB.console.verbose("loaded", loaded);

                    // Hide all views
                    $('[data-component-view]').each(function () {
						var elm = $(this);
		    			var visibility = elm.attr("data-component-view-visibility") || null;
            			if (visibility === "hidden") {
            				elm.css("visibility", "hidden");
            			} else {
            				elm.addClass("hidden");
            			}
                    });

                    $('[data-component-id]').each(function () {

                    	var tag = $(this);

						var attrs = {};
						$.each(this.attributes, function () {
							if(this.specified) {
								attrs[this.name] = (""+this.value).replace(/(^\s+|\s+$)/g, "");
							}
						});

						if (attrs["data-component-view"]) {
							return;
						}

                    	var id = attrs["data-component-id"];
                    	delete attrs["data-component-id"];


                    	var anchors = {};
	                    $('[data-component-anchor-id]', tag).each(function () {
	                    	var anchor = $(this);
							var attrs = {};
							$.each(this.attributes, function () {
								if(this.specified) {
									attrs[this.name] = (""+this.value).replace(/(^\s+|\s+$)/g, "");
								}
							});
	                    	anchors[attrs["data-component-anchor-id"]] = {
	                    		tag: anchor.prop("tagName"),
	                    		attributes: attrs
	                    	}
	                    	// We erase the content of the anchor as it will be replaced later.
	                    	anchor.html("");
	                    });


                    	var componentHtml = tag.html();
                    	// Remove `jsdom` dirt
                    	// TODO: Add method to `jsdom` to remove dirt it adds itself so implementation does not drift
                    	componentHtml = componentHtml.replace(/<script class="jsdom" src="[^"]+"><\/script>/g, "");

                    	declarations.components[id] = {
                    		tag: tag.prop("tagName"),
                    		attributes: attrs,
                    		innerHTML: componentHtml,
                    		anchors: anchors
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

						if (/^https?:\/\//.test(attrs.src)) {
							// TODO: Optionally download external resource and use locally instead
							//       of keeping external URL in source.
							return;
						}

						declarations.resources.push({
                    		tag: tag.prop("tagName"),
                    		attributes: attrs
						});
                    });
				}

                var declarations = {
                	schemas: {},
                	resources: [],
                	components: {}
                };

				parseRawHtml(html, declarations);

				return LIB.Q.denodeify(function (callback) {

					var virtualConsole = LIB.JSDOM.createVirtualConsole();
					virtualConsole.on("jsdomError", function (error) {
						console.error(error.message, error.detail);
					});

					var loaded = [];

					var features = {};
					if (
						options.config.resources &&
						options.config.resources.import === false
					) {
						features.FetchExternalResources = false;
						features.ProcessExternalResources = false;
					} else {
						features.FetchExternalResources = ["script", "frame", "iframe", "link"];
						features.ProcessExternalResources = ["script"];
					}

			        return LIB.JSDOM.env({
			        	url: url,
			        	headers: {
			        		"X-Component-Namespace": ";convert-to-data;"
			        	},
			        	scripts: [
	                    	'file://' + require.resolve("jquery/dist/jquery.js")
                    	],
                    	features: features,
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

								$(function () {

			                        parseInstanciatedHtml(loaded, window, declarations);

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

			function exportResources (originUrl, baseUrl, declarations) {

				if (
					options.config.resources &&
					options.config.resources.import === false
				) {
					return LIB.Q.resolve();
				}

				var baseUrlParsed = LIB.URL.parse(baseUrl);
				var basePath = LIB.PATH.join(targetBaseFsPath, "resources");

				function makeSourceUrl (url) {
					var sourceUrl = null;
					if (/^\//.test(url)) {
						sourceUrl = LIB.PATH.join(originUrl, url).replace(/^http:\//, "http://");;
					} else
					if (/^\./.test(url)) {
						sourceUrl = LIB.PATH.join(baseUrl, url).replace(/^http:\//, "http://");;
					} else {
						throw new Error("Cannot make source url fromnon-local url '" + url + "'!");
					}
					var sourceUrlParsed = LIB.URL.parse(sourceUrl);
					if (sourceUrlParsed.host !== baseUrlParsed.host) {
						// The host has changed after normalizing the path
						// so we assume it is an invalud URL
						sourceUrl = "";
					}
					return sourceUrl;
				}

				function getFileStorageHandlerForUrl (url, basePath, subPath) {

					var urlParsed = LIB.URL.parse(url);
					var localPath = LIB.PATH.join(basePath, subPath, urlParsed.pathname.substring(1).replace(/\//g, "~"));

					function ensureDirectories () {
						return LIB.QFS.exists(LIB.PATH.dirname(localPath)).then(function (exists) {
							if (exists) return;
							return LIB.QFS.makeTree(LIB.PATH.dirname(localPath));
						});
					}

					return ensureDirectories().then(function () {

						return {
							downloadPath: localPath,
							onDownloaded: function () {
								if (!filesMoved[localPath]) {
									filesMoved[localPath] = LIB.QFS.read(localPath).then(function (data) {

										var path = localPath.split(".");
										var ext = path.pop();
										path = path.join(".");

										path += "-" + LIB.CRYPTO.createHash("sha1").update(data).digest("hex").substring(0, 7);
										path += "." + ext;

										return LIB.QFS.exists(path).then(function (exists) {
											if (exists) {
												return LIB.QFS.exists(localPath).then(function (exists) {
													if (exists) {
														return LIB.QFS.remove(localPath);
													}
												});
											}
											return LIB.QFS.move(localPath, path);
										}).then(function () {
											return {
												relpath: "/" + LIB.PATH.relative(targetBaseUriPath, path),
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
					return LIB.QFS.exists(basePath).then(function (exists) {
						if (exists) return;
						return LIB.QFS.makeTree(basePath);
					});
				}

				var rewrites = [];

				return ensureDirectories().then(function () {

					return LIB.Q.all(declarations.resources.map(function (resource) {

						if (
							resource.tag === "LINK" &&
							resource.attributes.rel === "stylesheet"
						) {

							var url = "http://" + options.config.source.server.host + resource.attributes.href;

							LIB.console.verbose("Fetch resource '" + url + "' so we can export it");

							return fetchUrl(url).then(function (css) {

								// https://github.com/jakubpawlowicz/clean-css
								// https://github.com/Automattic/juice

								var targetFilename = LIB.CRYPTO.createHash("sha1").update(
									resource.attributes.href
								).digest("hex");

								var targetPath = LIB.PATH.join(basePath, targetFilename + ".css");

								resource.exportPath = targetPath;
								resource.attributes.href =  "/" + LIB.PATH.relative(targetBaseUriPath, targetPath);

								function parseUrls (css) {

									var urls = {};

									var output = LIB.REWORK(css, {
										source: targetPath
									})
									.use(LIB.REWORK_PLUGIN_URL(function(url) {

										if (/^(\/|\.)/.test(url)) {
											// Only process URLs pointing to our server.

											urls[url] = {
												sourceUrl: makeSourceUrl(url)
											};
										}

										return url;
									}));

									return LIB.Q.resolve(urls);
								}

								function downloadUrls (urls) {
									return LIB.Q.all(Object.keys(urls).filter(function (id) {
										return (!!urls[id].sourceUrl);
									}).map(function (id) {

										return getFileStorageHandlerForUrl(urls[id].sourceUrl, basePath, "assets").then(function (handler) {

											return downloadUrl(urls[id].sourceUrl, handler.downloadPath).then(function (status) {

												if (status !== 200) {
													console.log("Warning: Got status '" + status + "' for url '" + urls[id].sourceUrl + "'");
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
									return LIB.Q.resolve(
										LIB.REWORK(css, {
											source: targetPath
										})
										.use(LIB.REWORK_PLUGIN_URL(function(url) {
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

											return LIB.QFS.write(targetPath, css);
										});
									});
								});
							});

						} else
						if (
							resource.tag === "IMG" ||
							resource.tag === "SCRIPT"
						) {

							var url = resource.attributes.src;
							if (/^https?:\/\//.test(url)) {
								// TODO: Optionally download external resource and use locally instead
								//       of keeping external URL in source.
								return;
							}

							var sourceUrl = makeSourceUrl(url);

							LIB.console.verbose("Fetch resource '" + sourceUrl + "' so we can export it");

							return getFileStorageHandlerForUrl(
								sourceUrl,
								basePath,
								( resource.tag === "SCRIPT" ? "" : "assets" )
							).then(function (handler) {

								return downloadUrl(sourceUrl, handler.downloadPath).then(function (status) {

									function finalize (info) {

										if (resource.tag === "SCRIPT") {
// TODO: Only erase scripts if requested in config for page/component
/*
											rewrites.push({
												from: new RegExp('(<\\s*script.*?\\ssrc\\s*=\\s*[\'"]{1})' + LIB.REGEXP_ESCAPE(resource.attributes.src) + '([\'"]{1}.+?<\\s*\\/\\s*script\\s*>)', 'g'),
												to: ""
											});
*/
											rewrites.push({
												from: new RegExp('(<\\s*script.*?\\ssrc\\s*=\\s*[\'"]{1})' + LIB.REGEXP_ESCAPE(resource.attributes.src) + '([\'"]{1}.+?<\\s*\\/\\s*script\\s*>)', 'g'),
												to: "$1" + info.relpath + "$2"
											});
										} else {
											rewrites.push({
												from: new RegExp('(src\\s*=\\s*[\'"]{1})' + LIB.REGEXP_ESCAPE(resource.attributes.src) + '([\'"]{1})', 'g'),
												to: "$1" + info.relpath + "$2"
											});
										}

										resource.attributes.src = info.relpath;
										resource.exportPath = info.realpath;
									}

									if (status !== 200) {
										console.log("Warning: Got status '" + status + "' for url '" + sourceUrl + "'");
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

				var basePath = LIB.PATH.join(targetBaseFsPath, "components", componentGroupAlias);

				function ensureDirectories () {
					return LIB.QFS.exists(basePath).then(function (exists) {
						if (exists) return;
						return LIB.QFS.makeTree(basePath);
					});
				}

				function generateComponentFormats (alias, component) {

					function getComponentHtml () {
						var data = [];

						var attrs = Object.keys(component.attributes).map(function (name) {
							return name + '="' + component.attributes[name].replace(/"/g, '\\"') + '"';
						});
						attrs = ((attrs.length > 0)? (" " + attrs.join(" ")) : "");
						data.push('    <' + component.tag.toLowerCase() + attrs + '>');

						var impl = component.innerHTML;
						if (rewrites) {
							rewrites.forEach(function (rewrite) {
								impl = impl.replace(rewrite.from, rewrite.to);
							});
						}
						data.push(impl);

						data.push('    </' + component.tag.toLowerCase() + '>');

						return data.join("\n");
					}

					function generateHtml (component) {
						return LIB.Q.fcall(function () {
							var data = [];

							data.push('<!DOCTYPE ' + (declarations.schemas.DOCTYPE || "HTML") + '>');

							if (component.tag === "HTML") {

								data.push(getComponentHtml());

							} else {

								data.push('<html>');

								data.push('  <head>');
								declarations.resources.forEach(function (resource) {
									if (resource.tag !== "LINK") return;
									data.push('    <link rel="stylesheet" href="' + resource.attributes.href + '">');
								});
								data.push('  </head>');

								if (component.tag !== "BODY") data.push('  <body>');
								data.push(getComponentHtml());
								if (component.tag !== "BODY") data.push('  </body>');

								declarations.resources.forEach(function (resource) {
									if (resource.tag !== "SCRIPT") return;
									data.push('    <script src="' + resource.attributes.src + '"></script>');
								});

								data.push('</html>');

							}

							return data.join("\n");
						});
					}

					function camelCase (input) { 
					    return input.toLowerCase().replace(/-(.)/g, function(match, group1) {
					        return group1.toUpperCase();
					    });
					}

					function generateJSX (component) {
						return LIB.Q.fcall(function () {
							var data = [];
							data.push("module.exports = function (Context) {");
							data.push("  // TODO: Remove this once we can inject 'React' automatically at build time.");
							data.push("  var React = Context.REACT;");
							data.push("  return (");

							var html = getComponentHtml();
							html = html.replace(/(<|\s)class(\s*=\s*")/g, "$1className$2");
							html = html.replace(/(<\s*(?:img|input)\s+[^>]+?)(?:\/)?(\s*>)/g, "$1/$2");

							var re = /(<|\s)component\s*:\s*([^=]+)(\s*=\s*"[^"]*"(?:\/?>|\s))/g;
							var m;
							while (m = re.exec(html)) {
								html = html.replace(
								    new RegExp(LIB.REGEXP_ESCAPE(m[0]), "g"),
								    m[1] + "data-component-" + m[2].replace(/:/g, "-") + m[3]
								);
							}

							re = /(<|\sstyle\s*=\s*)"([^"]*)"((?:\/?>|\s))/g;
							while (m = re.exec(html)) {
								var attributes = {};
								var re2 = /(?:^|;)\s*([^:;]+)\s*:\s*(.+?)(?:;|$)/g
								var m2;
								while (m2 = re2.exec(m[2])) {
									attributes[camelCase(m2[1])] = m2[2];
								}

								html = html.replace(m[0], m[1] + "{" + JSON.stringify(attributes) + "}" + m[3]);
							}

							data.push(html);

							data.push("  );");
							data.push("}");

							return data.join("\n");
						});
					}

					if (!declarations.components[alias].exportPaths) {
						declarations.components[alias].exportPaths = {};
					}

					return generateHtml(component).then(function (data) {

						var targetPath = LIB.PATH.join(basePath, alias + ".htm");

						declarations.components[alias].exportPath = targetPath;
						declarations.components[alias].exportPaths["htm"] = targetPath;

						console.log("Writing component '" + alias + "' to '" + targetPath + "': ");

						return LIB.QFS.write(targetPath, data);

					}).then(function () {

						return generateJSX(component).then(function (data) {

							var targetPath = LIB.PATH.join(basePath, alias + ".cjs.jsx");

							declarations.components[alias].exportPaths["cjs.jsx"] = targetPath;

							console.log("Writing component '" + alias + "' to '" + targetPath + "':");

							return LIB.QFS.write(targetPath, data);
						});
					});
				}

				return ensureDirectories().then(function () {

					return LIB.Q.all(Object.keys(declarations.components).map(function (alias) {

						return generateComponentFormats(
							alias,
							declarations.components[alias]
						);

						// https://github.com/pocketjoso/penthouse

					}));
				}).then(function () {
					return basePath;
				});
			}

			var pages = {};
			return LIB.Q.all(Object.keys(options.config.pages).map(function (alias) {

				var origin = "http://" + options.config.source.server.host;
				var url = origin + options.config.pages[alias].source;
				
				if (
					options.uri &&
					options.config.pages[alias].source !== options.uri
				) {
					// The page uri does not match the one requested on the command-line.
					LIB.console.verbose("Skip: Fetch '" + url + "' because only '" + options.uri + "' was requested by '--uri' command-line option!");
					return LIB.Q.resolve();
				}

				LIB.console.verbose("Fetch '" + url + "'");

				return fetchUrl(url).then(function (html) {

					return parseHtml(url, html).then(function (declarations) {

						return exportResources(origin, LIB.PATH.dirname(url), declarations).then(function (rewrites) {

							return exportComponents(alias, declarations, rewrites).then(function (basePath) {

								pages[alias] = declarations;

								var defintionPath = basePath + ".json";

								return LIB.QFS.write(defintionPath, JSON.stringify(declarations, null, 4));
							});
						});
					});
				});
			})).then(function () {
				return pages;
			});
		});
	}

	return exports;
}
