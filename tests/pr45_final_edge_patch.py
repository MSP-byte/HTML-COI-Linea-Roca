from pathlib import Path

text = Path('index.html').read_text(encoding='utf-8')
needles = [
    'upsertTimelineEventsSupabase(client',
    "client.rpc('coi_timeline_replace_events'",
    "client.rpc('coi_timeline_delete_event'",
    'function reconcileTimelineAfterConcurrentMutation',
    "const authEvent=event.detail?.event||'';",
    'backup maestro V58.1',
    'function timelineEventToDatabase(raw)'
]
for needle in needles:
    print('\n===== '+needle+' =====')
    start = 0
    found = 0
    while True:
        pos = text.find(needle, start)
        if pos < 0:
            break
        found += 1
        lo = max(0, pos - 700)
        hi = min(len(text), pos + 1400)
        print(text[lo:hi])
        start = pos + len(needle)
    print('occurrences:', found)
raise SystemExit('probe complete')
