<div class="row">
	<div class="col-lg-12">
		<div class="panel panel-default">

			<div class="panel-heading"><h4>DB Search</h4></div>

			<div class="panel-body">

				<div class="alert alert-info">
				Topics Indexed: <strong id="topics-indexed">{topicsIndexed}</strong> / <strong>{topicCount}</strong>
				</div>
				<div class="progress">
					<div class="topic-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:{progressData.topicsPercent}%;min-width: 2em;">{progressData.topicsPercent}%</div>
				</div>

				<div class="alert alert-info">
				Posts Indexed: <strong id="posts-indexed">{postsIndexed}</strong> / <strong>{postCount}</strong>
				</div>
				<div class="progress">
					<div class="post-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:{progressData.postsPercent}%;min-width: 2em;">{progressData.postsPercent}%</div>
				</div>

				<button class="btn btn-warning" id="reindex" <!-- IF working -->disabled<!-- ENDIF working -->>Re Index</button>
				<button class="btn btn-danger" id="clear-index">Clear Index</button>
				<span id="work-in-progress" class="<!-- IF !working -->hidden<!-- ENDIF !working -->">
					<i class="fa fa-gear fa-spin"></i> Working...
				</span>
				<hr/>

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

				<input id="csrf_token" type="hidden" value="{csrf}" />
			</div>
		</div>
	</div>
</div>