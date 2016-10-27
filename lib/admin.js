'use strict';
/* globals app, define, socket, config */

define('admin/plugins/dbsearch', [], function() {
	$(document).ready(function() {
		var intervalId = 0;

		function startProgress(msg) {
			function checkProgress() {
				socket.emit('admin.plugins.dbsearch.checkProgress', function(err, progress) {
					if (err) {
						clearProgress();
						return app.alertError(err.message);
					}

					if (progress.topicsPercent >= 100 && progress.postsPercent >= 100) {
						clearInterval(intervalId);
						progress.topicsPercent = 100;
						progress.postsPercent = 100;
						app.alertSuccess(msg);
					}
					if (msg === 'Content Indexed!') {
						$('#topics-indexed').text(progress.topicsProcessed);
						$('#posts-indexed').text(progress.postsProcessed);
					}
					$('.topic-progress').css('width', progress.topicsPercent + '%').text(progress.topicsPercent + '%');
					$('.post-progress').css('width', progress.postsPercent + '%').text(progress.postsPercent + '%');
				});
			}

			clearProgress();
			checkProgress();

			intervalId = setInterval(checkProgress, 750);
		}

		function clearProgress() {
			if (intervalId) {
				clearInterval(intervalId);
				intervalId = 0;
			}
			$('.progress-bar').css('width', '0%').text('0%');
		}

		$('#save').on('click', function() {
			$.post(config.relative_path + '/api/admin/plugins/dbsearch/save', {
				_csrf : $('#csrf_token').val(),
				topicLimit: $('#topicLimit').val(),
				postLimit : $('#postLimit').val()
			}, function(data) {
				if(typeof data === 'string') {
					app.alertSuccess('Settings saved');
				}
			});

			return false;
		});

		$('#clear-index').on('click', function() {
			socket.emit('admin.plugins.dbsearch.clearIndex', function(err) {
				if (err) {
					app.alertError(err.message);
					clearProgress();
				}
				$('#topics-indexed').text('0');
				$('#posts-indexed').text('0');
			});
			startProgress('Index Cleared!');
			return false;
		});

		$('#reindex').on('click', function() {
			socket.emit('admin.plugins.dbsearch.reindex', function(err, data) {
				if (err) {
					app.alertError(err.message);
					clearProgress();
				}
				$('#topics-indexed').text(data.topicsIndexed);
				$('#posts-indexed').text(data.postsIndexed);
			});
			startProgress('Content Indexed!');
			return false;
		});
	});
});