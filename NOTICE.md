NextMusic Server — layered work notice
- Base: lxserver (github.com/XCQ0607/lxserver), Apache-2.0. Original LICENSE retained at /server/public/LICENSE.
- Modifications by MUBEY (2026-09-18): NextMusic web console v3.x (/server/public), NextMusic web player (/server/public/music), source-auth gate + musicSdk API surface (/server/server/server/server.js), bcrypt credential migration (/server/server + bcryptjs dep).
- Server runtime code otherwise upstream. Data persists in /server/data (mount as volume).
