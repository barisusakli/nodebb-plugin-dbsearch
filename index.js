'use strict';

var winston = require('winston'),
	fs = require('fs'),
	path = require('path'),
	async = require('async'),

	db = module.parent.require('./database'),
	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),
	utils = module.parent.require('./../public/src/utils'),
	templates = module.parent.require('./../public/src/templates');

(function(search) {
	var defaultPostLimit = 50,
		defaultTopicLimit = 50,
		postLimit = defaultPostLimit,
		topicLimit = defaultTopicLimit;

	db.getObject('nodebb-plugin-dbsearch', function(err, data) {
		if (err) {
			return winston.error(err.error);
		}

		if (data) {
			postLimit = data.postLimit ? data.postLimit : defaultPostLimit;
			topicLimit = data.topicLimit ? data.topicLimit : defaultTopicLimit;
		}
	});

	search.postSave = function (postData) {
		if(postData && postData.pid && postData.content) {
			db.searchIndex('post', postData.content, postData.pid);
		}
	};

	search.postDelete = function (pid) {
		if(pid) {
			db.searchRemove('post', pid);
		}
	};

	search.postRestore = function (postData) {
		search.postSave(postData);
	};

	search.postEdit = function (postData) {
		search.postSave(postData);
	};

	search.topicSave = function(tid) {
		search.reIndexTopicTitle(tid);
	};

	search.topicDelete = function(tid) {
		db.searchRemove('topic', tid);
	};

	search.topicRestore = function(tid) {
		search.reIndexTopicTitle(tid);
	};

	search.topicEdit = function(tid) {
		search.reIndexTopicTitle(tid);
	};

	search.searchQuery = function(data, callback) {
		if(data && data.index && data.query) {
			var limit = data.index === 'post' ? postLimit : topicLimit;
			db.search(data.index, data.query, limit, callback);
		} else {
			callback(null, []);
		}
	};

	search.reindex = function(callback) {
		db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
			if (err) {
				return callback(err);
			}

			async.each(tids, search.reIndexTopic, callback);
		});
	};

	search.reIndexTopic = function(tid, callback) {
		async.parallel([
			function (next) {
				search.reIndexTopicTitle(tid, next);
			},
			function (next) {
				topics.getPids(tid, function(err, pids) {
					if (err) {
						return next(err);
					}

					search.reIndexPids(pids, next);
				});
			}
		], callback);
	};

	search.reIndexTopicTitle = function(tid, callback) {
		if (!tid) {
			if (typeof callback === 'function') {
				return callback(new Error('invalid-tid'));
			}
		}

		topics.getTopicField(tid, 'title', function(err, title) {
			if (err) {
				if (typeof callback === 'function') {
					return callback(err);
				}
			}

			db.searchRemove('topic', tid, function() {
				if (typeof title === 'string' && title.length) {
					db.searchIndex('topic', title, tid);
				}

				if (typeof callback === 'function') {
					callback();
				}
			});
		});
	};

	search.reIndexPids = function(pids, callback) {
		async.each(pids, search.reIndexPid, callback);
	};

	search.reIndexPid = function(pid, callback) {
		posts.getPostField(pid, 'content', function(err, content) {
			if (err) {
				return callback(err);
			}

			db.searchRemove('post', pid, function() {
				if (typeof content === 'string' && content.length) {
					db.searchIndex('post', content, pid);
				}
				callback();
			});
		});
	};

	var admin = {};
	admin.menu = function(custom_header, callback) {
		custom_header.plugins.push({
			route: '/plugins/dbsearch',
			icon: 'fa-search',
			name: 'DB Search'
		});

		return custom_header;
	};

	admin.route = function(custom_routes, callback) {

		fs.readFile(path.join(__dirname, 'public/templates/admin.tpl'), function(err, tpl) {

			custom_routes.routes.push({
				route: '/plugins/dbsearch',
				method: 'get',
				options: function(req, res, callback) {

					db.getObject('nodebb-plugin-dbsearch', function(err, data) {
						if (!data) {
							data = {
								topicLimit: defaultTopicLimit,
								postLimit: defaultPostLimit
							};
						}
						var newTpl = templates.prepare(tpl.toString()).parse(data);

						callback({
							req: req,
							res: res,
							route: '/plugins/dbsearch',
							name: 'DB Search',
							content: newTpl
						});
					});
				}
			});

			custom_routes.api.push({
				route: '/plugins/dbsearch/reindex',
				method: 'post',
				callback: function(req, res, callback) {
					search.reindex(function(err) {
						if(err) {
							return res.json(500, 'failed to reindex');
						}

						res.json('Content reindexed');
					});
				}
			});

			custom_routes.api.push({
				route: '/plugins/dbsearch/save',
				method: 'post',
				callback: function(req, res, callback) {
					if(utils.isNumber(req.body.postLimit) && utils.isNumber(req.body.topicLimit)) {
						var data = {
							postLimit: req.body.postLimit,
							topicLimit: req.body.topicLimit
						};

						db.setObject('nodebb-plugin-dbsearch', data, function(err) {
							if (err) {
								res.json(500, 'error-saving');
							}

							postLimit = data.postLimit;
							topicLimit = data.topicLimit;

							res.json('Settings saved!');
						});
					}
				}
			});

			callback(null, custom_routes);
		});
	};

	search.admin = admin;

}(module.exports));

