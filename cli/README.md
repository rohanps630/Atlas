# cli/

Command implementations invoked by `bin/atlas.js`. Phase 0 ships only the stub in
`bin/atlas.js`; Phase 1 moves real command logic here (`scan`, `context`).
Keep commands thin — they parse args, call `core/`, and format output.
