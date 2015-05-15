<h1>DB Search</h1>

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

<br/>
<br/>
<div class="progress hidden">
	<div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="min-width: 2em;">0%</div>
</div>

<input id="csrf_token" type="hidden" value="{csrf}" />

<script type="text/javascript">
'use strict';
/* globals app, socket */
$(document).ready(function() {
	var intervalId =0 ;

	function startProgress(msg) {
		$('.progress').removeClass('hidden');

		clearProgress();

		intervalId = setInterval(function() {
			socket.emit('admin.plugins.dbsearch.checkProgress', function(err, progress) {
				if (err) {
					clearProgress();
					return app.alertError(err.message);
				}

				if (progress >= 100) {
					clearInterval(intervalId);
					progress = 100;
					app.alertSuccess(msg);
				}
				$('.progress-bar').css('width', progress + '%').text(progress + '%');
			});
		}, 750);
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
		});
		startProgress('Index Cleared!');
		return false;
	});

	$('#reindex').on('click', function() {
		socket.emit('admin.plugins.dbsearch.reindex', function(err) {
			if (err) {
				app.alertError(err.message);
				clearProgress();
			}
		});
		startProgress('Content Indexed!');

		return false;
	});
});

</script>