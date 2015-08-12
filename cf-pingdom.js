_ = lodash;
Apps = new Mongo.Collection('apps');
Settings = new Mongo.Collection('settings');
if (Meteor.isClient) {
  Meteor.startup(function(){
    Meteor.setInterval(function(){
      Meteor.call('getApps',function(err,result){
        Session.set('apps',result);
      });
    },1000);
  });
  Template.apps.helpers({
    result: function(){
      return Session.get('apps');
    }
  });

  Template.authorize.helpers({
    settings: function(){ return Settings.findOne({_id:1}); }
  })
  Template.authorize.events({
    'submit .auth-form':function(event){
      event.preventDefault();
      var settings = {
        api: $("[name=api]").val(),
        username: $("[name=username]").val(),
        password: $("[name=password]").val()
      }
      Meteor.call('authorize',settings);
    }
  });
  Template.apps.events({
    'submit .healthcheck': function(event) {
      event.preventDefault();
      var healthcheckUrl = $("#"+this._id).val();
      Meteor.call('setHealthcheck', this._id, healthcheckUrl);
    }
  })
}

if (Meteor.isServer) {
  var CFClient = Meteor.npmRequire('cloudfoundry-client');
  var request = Meteor.npmRequire('request');
  var Q = Meteor.npmRequire('q');
  var WebhookURL = 'https://hooks.slack.com/services/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'
  var SlackClient = Meteor.npmRequire('slack-notify')(WebhookURL);

  function apiResponseToApps(input){
    return _.map(input, function(i) {
      return {
        _id: i.metadata.guid,
        entity: i.entity
      }})
  }

  // function compare(apps, apiResponse) {
    // parsedApiResponse = transformResult(apiResponse);
    // var diff = [];
    // _.forEach(parsedApiResponse,function(i){
      // if (!_.find(apps,function(app){
        // return app._id === i._id && app.entity.state === i.entity.state;
      // })) {
        // diff.push(i);
      // }
    // });

    // return _.filter(parsedApiResponse,function(i){
      // return _.find(diff,{_id:i._id});
    // });

  // }

  Meteor.startup(function () {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

    Meteor.setInterval(function(){
      var cfSettings = Settings.findOne({_id: 1});
      if (cfSettings) {
        var cfClient = new CFClient({
          host: cfSettings.api,
          protocol: "https",
          email: cfSettings.username,
          password: cfSettings.password
        });

        var response = Async.runSync(function(done) {
          cfClient.apps.get(function(err, apps) {
            done(err, apps);
          });
        });
        var apps = apiResponseToApps(response.result);

        function performHealthcheck(app, cb){
          request(cfSettings.api.replace('api',app.entity.name),function(err,rsp,body){
            if (!err && rsp.statusCode == 200 && app.failing == true){
              app.failing = false;
              app.failureMessage = 'Healthcheck Passed!';
            } else if (rsp.statusCode !== 200 && app.failing == false) {
              app.failing = true;
              app.failureMessage = 'Healthcheck failed! Status code: ' + rsp.statusCode;
            }
            cb(app);
          });
        }

        function compareState(app, previousState, cb) {
          var messages = {
            "STOPPED": app.entity.name+" has stopped running!",
            "STARTED": app.entity.name+" has recovered!",
          }
          if (previousState == app.entity.state) {
            return;
          } else {
            app.failureMessage = messages[app.entity.state]
          }
          cb(app);
        }

        _.forEach(apps, function(app) {
          onComplete = function(app) {
            if (app.failureMessage) {
              SlackClient.send({
                channel: '#buildpack-webhook',
                text: app.failureMessage
              });
            }
          }
          if (app.healthcheckUrl) {
            console.log(app.entity.name+ " is healthchecking")
            performHealthcheck(app, onComplete)
          } else {
            console.log(app.entity.name+" is not healthchecking")
            var previousState = Apps.findOne({_id: app._id}).entity.state
            compareState(app, previousState, onComplete)
          }
        })

        /* {_id: 5932852,
         * healthcheckUrl: null,
         *  previousState: "STOPPED",
         *  entity: { state: "STARTED" }
         *  }
         *  */




        // var different = compare(CurrentApps, response.result)
        /*
        _.forEach(different,function(app){
          Apps.update({_id:app._id},{
            _id: app._id,
            entity: app.entity
          },{upsert:true});

          //notify
          messages = {
            "STOPPED": app.entity.name+" has stopped running!",
            "STARTED": app.entity.name+" has recovered!",
          }
          //if has helathcheck ->   check it, if failed Send a message
          SlackClient.send({
            channel: '#buildpack-webhook',
            text: messages[app.entity.state]
          });
        });
        */
        //for all of the apps except the in difference
        //check and verify
      }
    },1000);
  });
  Meteor.methods({
    'getApps': function() {
      return Apps.find().fetch();
    },
    'setHealthcheck': function(id,url){
      Apps.update({_id: id}, {$set:{healthcheckUrl: url}})
    },
    'authorize': function(settings){
      settings._id = 1;
      Settings.update({_id:1},settings,{upsert:true});
    }
  })
}

