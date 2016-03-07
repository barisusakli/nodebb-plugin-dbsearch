<div class="row">
	<div class="col-lg-12">
		<div class="panel panel-default">

			<div class="panel-heading">DB Search</div>

			<div class="panel-body">

				<div class="alert alert-info">
				Total Topics: <strong>{topicCount}</strong> Topics Indexed: <strong id="topics-indexed">{topicsIndexed}</strong>
				</div>
				<div class="progress">
					<div class="topic-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="min-width: 2em;">0%</div>
				</div>

				<div class="alert alert-info">
				Total Posts: <strong>{postCount}</strong> Posts Indexed: <strong id="posts-indexed">{postsIndexed}</strong>
				</div>
				<div class="progress">
					<div class="post-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="min-width: 2em;">0%</div>
				</div>

				<form class="form">
					<div class="row">
						<div class="col-sm-4 col-xs-12">
							<div class="form-group">
								<label>Topic Limit</label>
								<input id="topicLimit" type="text" class="form-control" placeholder="Number of topics to return" value="{topicLimit}">
								<label>Post Limit</label>
								<input id="postLimit" type="text" class="form-control" placeholder="Number of posts to return" value="{postLimit}">
							</div>
						</div>
					</div>
				</form>


				<button class="btn btn-primary" id="save">Save</button>
				<button class="btn btn-warning" id="reindex">Re Index</button>
				<button class="btn btn-danger" id="clear-index">Clear Index</button>

				<input id="csrf_token" type="hidden" value="{csrf}" />
			</div>
		</div>
	</div>
</div>

<script type="text/javascript">
'use strict';
/* globals app, socket, config */
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

</script>