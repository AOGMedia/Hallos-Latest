const Mux = require("@mux/mux-node");
const Video = require("../models/Video");
const LiveClass = require("../models/liveClass");

const endpointSecret = process.env.MUX_WEBHOOK_SECRET;

const mux = new Mux();

exports.handleMuxWebhook = async (req, res) => {
  let event;

  const rawBody = req.body;
  
  if (!rawBody) {
    console.error("[Webhook] rawBody missing. Signature verification requires raw body.");
    return res.status(400).send("rawBody missing");
  }

  try {

    const rawBodyString = rawBody.toString('utf8');

    const isValidSignature = mux.webhooks.verifySignature(
      rawBodyString,        
      req.headers,       
      endpointSecret    
    );

    console.log("[Webhook] Signature verified:", isValidSignature);

    // Parse the JSON body after verification
    event = JSON.parse(rawBodyString);
    console.log("[Webhook] Event type:", event.type);

  } catch (err) {
    console.error("Mux webhook signature verification FAILED:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { type, data } = event;

  try {
    // ---------------- VIDEO ASSET EVENTS ----------------
    if (type === "video.asset.ready" && data.upload_id && !data.live_stream_id) {
      const playbackId = data.playback_ids?.[0]?.id || null;

      await Video.update(
        {
          status: "ready",
          muxAssetId: data.id,
          muxPlaybackId: playbackId,
          durationSeconds: Math.floor(data.duration || 0),
        },
        { where: { muxUploadId: data.upload_id } }
      );
      console.log(`[Webhook] Video asset ${data.id} marked as ready`);
    }

    if (type === "video.asset.errored" && data.upload_id && !data.live_stream_id) {
      await Video.update(
        { status: "failed" },
        { where: { muxUploadId: data.upload_id } }
      );
      console.log(`[Webhook] Video asset marked as failed`);
    }

    // ---------------- LIVE STREAM EVENTS ----------------
    if (data.live_stream_id) {
      if (type === "video.live_stream.active") {
        await LiveClass.update(
          { status: "live" },
          { where: { mux_stream_id: data.live_stream_id } }
        );
        console.log(`[Webhook] Live stream ${data.live_stream_id} is now active`);
      }

      if (type === "video.live_stream.idle") {
        await LiveClass.update(
          { status: "ended" },
          { where: { mux_stream_id: data.live_stream_id } }
        );
        console.log(`[Webhook] Live stream ${data.live_stream_id} is now idle`);
      }

      if (type === "video.live_stream.completed") {
        await LiveClass.update(
          { status: "recorded" },
          { where: { mux_stream_id: data.live_stream_id } }
        );
        console.log(`[Webhook] Live stream ${data.live_stream_id} completed`);
      }

      if (type === "video.asset.ready") {
        await LiveClass.update(
          {
            recording_asset_id: data.id,
            mux_playback_id: data.playback_ids?.[0]?.id || null,
          },
          { where: { mux_stream_id: data.live_stream_id } }
        );
        console.log(`[Webhook] Recording asset ${data.id} ready for live stream`);
      }
    }

    return res.status(200).send("Webhook processed successfully.");

  } catch (err) {
    console.error("[Webhook] Error processing event:", err);
    return res.status(500).send("Internal server error while processing webhook");
  }
};