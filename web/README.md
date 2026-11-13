# OSM Fix Bounty — web app

Vite + React + [genlayer-js](https://docs.genlayer.com/developers/decentralized-applications/genlayer-js).

```bash
npm install
VITE_CONTRACT_ADDRESS=0x... npm run dev   # or paste the address in the app
npm run build                             # static output in dist/
```

The app reads bounties and claims with `readContract`, sends `create_bounty` / `claim` / `close_bounty` through the
browser wallet (`window.ethereum`, switched to GenLayer Studionet, chain 61999), and follows each transaction through
PENDING → PROPOSING → COMMITTING → REVEALING → ACCEPTED before refreshing contract state.
