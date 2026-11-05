# Close Circle

A friend-group app for Sarosh, Hassan, Anthony, Jamser, and Aris. Posts, event polls, votes, and ideas are shared through a small Node server and saved to `data/circle.json`.

## Run the live shared version

Install Node.js 18 or newer, then run:

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173) and choose your name. The server saves the circle to disk, and connected pages refresh about every 2.5 seconds. To use it on the same Wi-Fi, open `http://<this-computer's-local-IP>:4173` from each device while this computer and server are running.

The server is dependency-free. Uploaded photos and videos are saved with the shared JSON state.

## GitHub Pages

GitHub Pages serves the static showcase, but it does not run the Node server. The Pages URL therefore shows local preview mode. Run the server above for shared live posts. To make the shared version available over the internet, deploy this Node app to a Node hosting service and use that hosted URL.

## Data

Shared data lives in the ignored `data/circle.json` file on the computer running the server. The repository contains no post data. Delete that file to reset the shared showcase.
