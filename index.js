'use strict';

var winston = require('winston'),
	async = require('async'),
	db = module.parent.require('./database'),
	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),
	utils = module.parent.require('../public/src/utils'),
	socketAdmin = module.parent.require('./socket.io/admin');

(function(search) {
	var defaultPostLimit = 50,
		defaultTopicLimit = 50,
		postLimit = defaultPostLimit,
		topicLimit = defaultTopicLimit;

	var batchSize = 500;

	var topicCount = 0,
		topicsIndexed = 0;

	search.init = function(params, callback) {
		params.router.get('/admin/plugins/dbsearch', params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
		params.router.get('/api/admin/plugins/dbsearch', params.middleware.applyCSRF, renderAdmin);

		params.router.post('/api/admin/plugins/dbsearch/save', params.middleware.applyCSRF, save);
		callback();

		db.getObject('nodebb-plugin-dbsearch', function(err, data) {
			if (err) {
				return winston.error(err.error);
			}

			if (data) {
				postLimit = data.postLimit ? data.postLimit : defaultPostLimit;
				topicLimit = data.topicLimit ? data.topicLimit : defaultTopicLimit;
			}
		});
	};

	search.postSave = function(postData, callback) {
		callback = callback || function() {};
		if (!postData || !postData.pid) {
			return callback();
		}
		var data = {};
		if (postData.content) {
			data.content = postData.content;
		}
		if (postData.cid) {
			data.cid = postData.cid;
		}
		if (postData.uid) {
			data.uid = postData.uid;
		}
		if (!Object.keys(data).length) {
			return callback();
		}

		db.searchIndex('post', data, postData.pid, callback);
	};

	search.postRestore = function(postData) {
		search.postSave(postData);
	};

	search.postEdit = function(postData) {
		search.postSave(postData);
	};

	search.postDelete = function(pid, callback) {
		db.searchRemove('post', pid, callback);
	};

	search.postMove = function(data) {
		topics.getTopicFields(data.post.tid, ['cid', 'deleted'], function(err, topic) {
			if (err) {
				return;
			}
			search.reIndexPids([data.post.pid], topic);
		});
	};

	search.topicSave = function(topicData, callback) {
		callback = callback || function() {};

		if (!topicData || !topicData.tid) {
			return callback();
		}
		var data = {};
		if (topicData.title) {
			data.content = topicData.title;
		}
		if (topicData.cid) {
			data.cid = topicData.cid;
		}
		if (topicData.uid) {
			data.uid = topicData.uid;
		}
		if (!Object.keys(data).length) {
			return callback();
		}

		db.searchIndex('topic', data, topicData.tid, callback);
	};

	search.topicRestore = function(topicData) {
		search.reIndexTopics([topicData.tid]);
	};

	search.topicEdit = function(topicData) {
		search.topicSave(topicData);
	};

	search.topicDelete = function(topicData, callback) {
		var tid = (void 0 === topicData.tid) ? topicData : topicData.tid;
		callback = callback || function() {};
		async.parallel({
			topic: function(next) {
				db.searchRemove('topic', tid, next);
			},
			posts: function(next) {
				topics.getPids(tid, function(err, pids) {
					if (err) {
						return next(err);
					}
					if (!Array.isArray(pids) || !pids.length) {
						return next();
					}
					async.eachLimit(pids, batchSize, search.postDelete, next);
				});
			}
		}, function(err, results) {
			callback(err);
		});
	};

	search.topicMove = function(data) {
		search.reIndexTopics([data.tid]);
	};

	search.searchQuery = function(data, callback) {
		if (!data || !data.index) {
			return callback(null, []);
		}
		var limit = data.index === 'post' ? postLimit : topicLimit;
		var query = {};
		if (data.cid) {
			query.cid = data.cid.filter(Boolean);
		}
		if (data.uid) {
			query.uid = data.uid.filter(Boolean);
		}
		if (data.content) {
			query.content = data.content;
		}
		if (!Object.keys(query).length) {
			return callback(null, []);
		}
		db.search(data.index, query, limit, callback);
	};

	search.reindex = function(callback) {
		topicsIndexed = 0;
		db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
			if (err) {
				return callback(err);
			}
			topicCount = tids.length;

			batch(tids, batchSize, function(currentTids, next) {
				topicsIndexed += batchSize;
				search.reIndexTopics(currentTids, next);
			}, function(err) {
				callback(err);
			});
		});
	};

	search.clearIndex = function(callback) {
		topicsIndexed = 0;

		db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
			if (err) {
				return callback(err);
			}
			topicCount = tids.length;
			async.eachLimit(tids, 500, function(tid, next) {
				search.topicDelete(tid, function(err) {
					if (err) {
						return next(err);
					}
					++topicsIndexed;
					next();
				});
			}, callback);
		});
	};

	search.reIndexTopics = function(tids, callback) {
		if (!Array.isArray(tids) || !tids.length) {
			return callback();
		}

		topics.getTopicsFields(tids, ['tid', 'title', 'uid', 'cid', 'deleted'], function(err, topicData) {
			if (err) {
				return callback(err);
			}

			topicData = topicData.filter(function(topic) {
				return parseInt(topic.tid, 10) && parseInt(topic.deleted, 10) !== 1;
			});

			async.each(topicData, function(topic, next) {
				async.parallel([
					function (next) {
						search.reIndexTopicData(topic, next);
					},
					function (next) {
						topics.getPids(topic.tid, function(err, pids) {
							if (err) {
								return next(err);
							}

							search.reIndexPids(pids, topic, next);
						});
					}
				], next);
			}, callback);
		});
	};

	search.reIndexTopicData = function(topic, callback) {
		if (parseInt(topic.deleted) === 1 || !parseInt(topic.tid, 10)) {
			return callback();
		}
		search.topicSave(topic, callback);
	};

	search.reIndexPids = function(pids, topic, callback) {
		callback = callback || function() {};

		if (!Array.isArray(pids) || !pids.length) {
			return callback();
		}

		batch(pids, batchSize, function(currentPids, next) {
			reIndexPids(currentPids, topic, next);
		}, callback);
	};

	function reIndexPids(pids, topic, callback) {
		if (!Array.isArray(pids) || !pids.length) {
			winston.warn('[nodebb-plugin-dbsearch] invalid-pid, skipping');
			return callback();
		}
		if (parseInt(topic.deleted) === 1) {
			return callback();
		}

		async.waterfall([
			function(next) {
				posts.getPostsFields(pids, ['pid', 'content', 'uid', 'tid'], next);
			},
			function(posts, next) {
				async.each(posts, function(post, next) {
					post.cid = topic.cid;
					search.postSave(post, next);
				}, next);
			}
		], callback);
	}

	function batch(array, count, iterator, callback) {
		var start = 0;
		var stop = count;
		var currentBatch = array;
		async.whilst(
			function() {
				return currentBatch.length > 0;
			},
			function(next) {
				currentBatch = array.slice(start, stop);
				if (!currentBatch.length) {
					return next();
				}

				start = stop;
				stop = start + count;

				iterator(currentBatch, next);
			},
			function(err) {
				callback(err);
			}
		);
	}

	function renderAdmin(req, res, next) {
		db.getObject('nodebb-plugin-dbsearch', function(err, data) {
			if (err) {
				return next(err);
			}

			if (!data) {
				data = {
					topicLimit: defaultTopicLimit,
					postLimit: defaultPostLimit
				};
			}
			data.csrf = req.csrfToken();
			res.render('admin/plugins/dbsearch', data);
		});
	}

	function save(req, res, next) {
		if (utils.isNumber(req.body.postLimit) && utils.isNumber(req.body.topicLimit)) {
			var data = {
				postLimit: req.body.postLimit,
				topicLimit: req.body.topicLimit
			};

			db.setObject('nodebb-plugin-dbsearch', data, function(err) {
				if (err) {
					return res.json(500, 'error-saving');
				}

				postLimit = data.postLimit;
				topicLimit = data.topicLimit;

				res.json('Settings saved!');
			});
		}
	}

	socketAdmin.plugins.dbsearch = {};
	socketAdmin.plugins.dbsearch.checkProgress = function(socket, data, callback) {
		if (!parseInt(topicCount, 10)) {
			return callback(null, 100);
		}
		callback(null, Math.min(100, ((topicsIndexed / topicCount) * 100).toFixed(2)));
	};

	socketAdmin.plugins.dbsearch.reindex = function(socket, data, callback) {
		search.reindex(function(err) {
			if (err) {
				return callback(err);
			}

			topicsIndexed = topicCount;
			callback();
		});
	};

	socketAdmin.plugins.dbsearch.clearIndex = function(socket, data, callback) {
		search.clearIndex(callback);
	};

	var admin = {};
	admin.menu = function(custom_header, callback) {
		custom_header.plugins.push({
			route: '/plugins/dbsearch',
			icon: 'fa-search',
			name: 'DB Search'
		});

		callback(null, custom_header);
	};

	search.admin = admin;

}(module.exports));

