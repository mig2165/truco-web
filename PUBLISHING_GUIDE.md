# Publishing Truco Web to the Cloud

Congratulations! Your entire game exists as standard, independent code files on your computer inside `/Users/migs/IdeaProjects/truco-web`. This code is **not** tied to Antigravity—you have full ownership and can publish it anywhere in the world! 

Because the game is split into a **Frontend (React)** and a **Backend (Node.js)**, you will need to host both. 

Here is exactly how you can permanently publish your game for free:

---

## ☁️ Option 1: Render.com (Highly Recommended, 100% Free)

Render is the modern standard for hosting web apps easily. It supports both Node.js websockets (for your game engine) and static sites (for your frontend website). 

**What you need:**
1. A free GitHub account (github.com)
2. A free Render account (render.com)

**Step 1: Upload your code to GitHub**
1. Open the Terminal on your Mac.
2. Navigate to your project folder: `cd /Users/migs/IdeaProjects/truco-web`
3. Push your code to a new repository on GitHub using `git`.

**Step 2: Host the Backend (Web Service)**
1. Log into your Render dashboard and click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure the backend:
    - **Name**: `truco-backend`
    - **Language**: `Node`
    - **Root Directory**: `server`
    - **Build Command**: `npm install && npm run build`
    - **Start Command**: `node dist/index.js`
    - **Instance Type**: Free Plan
4. Click **Create Web Service**. Wait 2-3 minutes for it to build.
5. Render will give you a live URL like `https://truco-backend-xyz.onrender.com`. Copy this URL!

**Step 3: Point Frontend to the Engine**
Before publishing the frontend, we need to tell it where the cloud game engine lives.
1. In your code, open `/client/.env.production` (create it if it doesn't exist).
2. Add this line using your new Render URL:
   `VITE_API_URL=https://truco-backend-xyz.onrender.com`
3. Commit this change to GitHub.

**Step 4: Host the Frontend (Static Site)**
1. In your Render dashboard, click **New +** -> **Static Site**.
2. Connect the same GitHub repository.
3. Configure the frontend:
    - **Name**: `truco-game`
    - **Root Directory**: `client`
    - **Build Command**: `npm install && npm run build`
    - **Publish Directory**: `dist`
4. Click **Create Static Site**.
5. Render will give you a URL like `https://truco-game-abc.onrender.com`.

**🎉 DONE!** Send that URL to your friends, and play 24/7! You no longer need `ngrok` or to keep your Mac turned on.

---

## ☁️ Option 2: Vercel + Heroku 

If you prefer different services, you can host the website on Vercel and the backend on Heroku. Note: Heroku's free tier was retired, so Heroku costs ~$7/month to keep the server online 24/7.
1. Push your code to GitHub.
2. Go to **Vercel.com**, link GitHub, and deploy the `client` folder. (Free)
3. Go to **Heroku.com**, link GitHub, and deploy the `server` folder. (Paid)

---

## 🛠️ Summary

Your code is 100% ready to deploy. The multiplayer socket architecture is already using standard standard `Socket.io` libraries and relative `.env` routing paths specifically built for cloud portability!

If you ever want help doing this, I can walk you through the GitHub terminal commands step-by-step whenever you're ready!
