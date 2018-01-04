// dependencies
const async = require("async");
const AWS = require("aws-sdk");
var gm = require("gm")
  .subClass({
    imageMagick: true
  }); // Enable ImageMagick integration.
const util = require("util");

// constants
const DEFAULT_DST_BUCKET = process.env.DST_BUCKET;
const OPTIMIZE_LEVEL = process.env.OPTIMIZE_LEVEL || 70;
const S3_OBJECT_ACL = process.env.S3_OBJECT_ACL || "private";
const S3_OBJECT_CACHE_MAX_AGE = process.env.S3_OBJECT_CACHE_MAX_AGE || 86400; // 1day

// get reference to S3 client
const s3 = new AWS.S3();

exports.handler = function(event, context, callback) {
  // Read options from the event.
  console.log("Reading options from event:\n", util.inspect(event, {
    depth: 5
  }));
  var srcBucket = event.Records[0].s3.bucket.name;
  // Object key may have spaces or unicode non-ASCII characters.
  var srcKey =
    decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
  var dstBucket = DEFAULT_DST_BUCKET || srcBucket + "-optimized";
  var dstKey = srcKey;

  // Sanity check: validate that source and destination are different buckets.
  if (srcBucket == dstBucket) {
    callback("Source and destination buckets are the same.");
    return;
  }

  // Infer the image type.
  var typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    callback("Could not determine the image type.");
    return;
  }
  var imageType = typeMatch[1];
  if (imageType != "jpg" && imageType != "png") {
    callback("Unsupported image type: ${imageType}");
    return;
  }

  // Download the image from S3, transform, and upload to a different S3 bucket.
  async.waterfall([
    function download(next) {
      // Download the image from S3 into a buffer.
      s3.getObject({
          Bucket: srcBucket,
          Key: srcKey
        },
        next);
    },
    function transform(response, next) {
      gm(response.Body).quality(OPTIMIZE_LEVEL).toBuffer(function(err, buffer) {
        if (err) {
          next(err);
        } else {
          console.log(`Successfully optimized. ${response.Body.byteLength} => ${buffer.byteLength} bytes.`);
          next(null, response.ContentType, buffer);
        }
      });
    },
    function upload(contentType, data, next) {
      // Stream the transformed image to a different S3 bucket.
      s3.putObject({
          Bucket: dstBucket,
          Key: dstKey,
          Body: data,
          ContentType: contentType,
          ACL: S3_OBJECT_ACL,
          CacheControl: `max-age=${S3_OBJECT_CACHE_MAX_AGE}`,
          Expires: new Date(new Date().getTime() + (S3_OBJECT_CACHE_MAX_AGE * 1000))
        },
        next);
    }
  ], function(err) {
    if (err) {
      console.error(
        "Unable to optimize " + srcBucket + "/" + srcKey +
        " and upload to " + dstBucket + "/" + dstKey +
        " due to an error: " + err
      );
    } else {
      console.log(
        "Successfully process done " + srcBucket + "/" + srcKey +
        " and uploaded to " + dstBucket + "/" + dstKey
      );
    }

    callback(null, `Image optimized successfully done!!`);
  });
};
