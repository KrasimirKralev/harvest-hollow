# Privacy

## Your own Harvest Hollow server

If you run Harvest Hollow yourself (the default single-farm mode: `npm start` on your own computer, a Raspberry Pi or
any box on your home network), **your server keeps your farm, and nothing goes anywhere else**:

- The farm (the names you type, your farmers' looks, notes, the game itself) lives in the server's data folder
  (`HH_DATA_DIR`, `./data` by default), with its journal and backups. Device keys are stored there only as hashes.
- Each browser keeps its key to the farm, its settings and the Memory Book's pictures in its own storage.
- The game makes no calls to other sites: no analytics, no ads, no tracking cookies, and the fonts, music and
  pictures come from your server. Links to GitHub (the source code, "Suggest an idea") open GitHub only when you
  choose them.
- The server's log lines (for example "slot claimed") may include the farmer's name and the address of the device on
  your network. They stay on your machine.

You are the one who decides what happens to that data. To delete a farm, stop the server and remove the data folder.

## The public site

The hosted multi-farm site has its own privacy page, in English and Bulgarian, at
[harvest-hollow.up.railway.app/privacy](https://harvest-hollow.up.railway.app/privacy) (the page itself is
`public/privacy.html` in this repository). It explains what that site keeps, why, for how long, who hosts it, and how to
ask for a copy or a deletion.
