# Home Assistant → Tracker

## Glucose fallback (plan 14)

Use this only if LibreView refuses the Worker's own LibreLinkUp polling: the home page's "LibreLinkUp" line shows
`http_403` (or similar) instead of a recent success. Home Assistant then polls LibreLinkUp from home and pushes each
new reading to Tracker.

1. Stop the Worker's poller: from `worker/`, `npx wrangler secret delete LLU_EMAIL`. Its line then shows
   `not_configured`.
2. In HA, install a LibreLinkUp integration from HACS. Pick the most maintained one at the time, and check it signs in
   with the follower account (the same one the Worker used).
3. Add Tracker's token to HA's `secrets.yaml` (the value of the Worker's `HA_INGEST_TOKEN` secret, with `Bearer `):

   ```yaml
   tracker_ingest_auth: "Bearer <HA_INGEST_TOKEN>"
   ```

4. A `rest_command` and an automation on the integration's glucose sensor (replace `sensor.glucose` with its entity
   id; if the integration has its own timestamp attribute, use that for `ts` instead of `last_changed`):

   ```yaml
   rest_command:
     tracker_glucose:
       url: https://tracker.ingles.place/api/ingest/glucose
       method: POST
       headers:
         Authorization: !secret tracker_ingest_auth
       content_type: application/json
       payload: >
         {"source": "ha", "readings": [{"ts": "{{ ts }}", "mgDl": {{ mg_dl | int }}}]}

   automation:
     - alias: Tracker glucose
       mode: queued
       trigger:
         - platform: state
           entity_id: sensor.glucose
       condition:
         - condition: template
           value_template: "{{ trigger.to_state.state | is_number }}"
       action:
         - service: rest_command.tracker_glucose
           data:
             ts: "{{ trigger.to_state.last_changed.isoformat() }}"
             mg_dl: "{{ trigger.to_state.state }}"
   ```

The route answers `{ "inserted": n, "duplicates": m }`; a wrong token is a `401`. HA's config repo is
`/workspaces/iot/home-assistant-config`.
