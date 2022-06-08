import nodemailer from "nodemailer";
import "dotenv/config";
import {readFileSync, writeFileSync} from "fs";
import fetch from "node-fetch";
import config from "./config.js";

const wait = true;

const readJSONFromPath = (path) => {
  let json;
  try {
    json = readFileSync(path, {encoding: "utf8"});
  } catch(e) {
    throw new Error("Unable to read file: "+path);
  }
  try {
    json = JSON.parse(json);
  } catch(e) {
    throw new Error("Unable to parse JSON: "+path);
  }
  return json;
}

const transporter = nodemailer.createTransport({
  host: process.env.MAILHOST,
  port: process.env.MAILPORT,
  secure: (process.env.MAILSECURE === true),
  auth: {
    user: process.env.MAILUSER,
    pass: process.env.MAILPWD,
  },
});

const verifyMail = () => {
  return new Promise(resolve => {
    transporter.verify(function (error, success) {
      if (error) {
        throw new Error(error);
      } else {
        resolve();
      }
    });
  });
};

const sendMail = (from, to, subject, text) => {
  return transporter.sendMail({
    from: '"RDV BOT" <'+from+'>', // sender address
    to, // list of receivers
    subject, // Subject line
    text, // plain text body
  });
}

const mockFetch = (url, options) => {
  return fetch(url, {
    ...options,
    headers: {
      "Host": "pro.rendezvousonline.fr",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:101.0) Gecko/20100101 Firefox/101.0",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.7,fr-FR;q=0.3",
      "Content-Type": "application/json",
      "Origin": "https://rendezvousonline.fr",
      "DNT": 1,
      "Connection": "keep-alive",
      "Referer": "https://rendezvousonline.fr/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors"
    }
  });
}

const randomWait = (minSeconds, maxSeconds) => {
  const delay = parseInt(Math.random()*(maxSeconds-minSeconds)+minSeconds);
  console.log("awaiting random time:", delay, "seconds");
  if (!wait) {
    return;
  }
  return new Promise(resolve => {
    setTimeout(() => {
      console.log("---");
      resolve();
    }, delay*1000);
  });
}

const getSessionID = async () => {
  let id = await mockFetch("https://pro.rendezvousonline.fr/api-web/auth/session", { method: "GET" });
  id = await id.json();
  id = id.session_id;
  console.log("new session id:", id);
  return id;
}

const getReasonID = async (placeID) => {
  let reasons = await mockFetch("https://pro.rendezvousonline.fr/api-web/structures/"+placeID+"/services", { method: "GET" });
  reasons = await reasons.json();
  reasons = reasons[0].reasons;
  reasons = reasons.find(e => {
    e = e.name.toLowerCase();
    if ((e.includes("cni") || e.includes("carte nationale d'identité"))
        && (e.includes("demande") || e.includes("dépôt"))
        && !(e.includes("double"))) {
          return true;
    }
    return false;
  });
  console.log(reasons.name);
  console.log("found reason ID:", reasons.id);
  return reasons.id;
}

const unlock = async (sessionID) => {
  const payload = {
    "session_id": sessionID
  };
  let unlock = await mockFetch("https://pro.rendezvousonline.fr/api-web/availabilities/unlock",
    { method: "PUT", body: JSON.stringify(payload) });
  unlock = await unlock.json();
  console.log(unlock.message);
}

const getAvailabilities = async (placeID, reasonID, sessionID) => {
  const date = (new Date()).toISOString().split("T")[0];
  reasonID = JSON.stringify({ [reasonID.toString()]: 1 });
  const url = "https://pro.rendezvousonline.fr/api-web/structures/"+placeID+"/availabilities/week?session_id="+sessionID+"&reasons="+reasonID+"&date="+date+"&direction=1";
  let av = await mockFetch(url, { method: "GET" });
  av = await av.json();
  if (av.message) {
    console.log(av.message);
    return "2025-12-31";
  }
  av = Object.values(av).filter(e => e.availabilities.length);
  av = av[0].date;
  console.log("best date:", av);
  return av;
}

const isBefore = (date1, date2) => {
  const date1TS = (new Date(date1)).valueOf();
  const date2TS = (new Date(date2)).valueOf();
  return (date1TS < date2TS) 
}

const main = async (init=false) => {
  console.log("starting...");
  let availabilities = [];
  let better = [];
  if (!init) {
    availabilities = readJSONFromPath("./av.json");
  }
  //~ await randomWait(60, 900);
  const sessionID = await getSessionID();
  for (const place of config) {
    console.log("working on:", place.name);
    //~ await randomWait(30, 300);
    const reasonID = await getReasonID(place.id);
    await randomWait(1, 5);
    await unlock(sessionID);
    await randomWait(1, 5);
    const placeAV = await getAvailabilities(place.id, reasonID, sessionID);
    if (init) {
      availabilities.push({
        id: place.id,
        best: placeAV
      });
    } else {
      let best = availabilities.find(e => e.id === place.id).best;
      //check if it's new date is sooner than current best
      if (isBefore(placeAV, best)) {
        better.push({
          place: place.name,
          date: placeAV
        })
      }
      availabilities.find(e => e.id === place.id).best = placeAV;
    }
  }
  writeFileSync("./av.json", JSON.stringify(availabilities), { encoding: "utf-8" });
  better = better.map(e => {
    return ` - Lieu : ${e.place}
 - Date : ${e.date}
`
  }).join(`---
`);
  const mailContent = `Nouveaux rendez-vous disponibles :

${better}
`;
  if (better.length) {
    await sendMail(
      process.env.MAILUSER, 
      process.env.MAILTO,
      "[RDVBOT] Nouveaux rendez-vous",
      mailContent
    );
  }
};

//~ main();
sendMail(
  process.env.MAILUSER, 
  process.env.MAILTO,
  "[RDVBOT] Nouveaux rendez-vous",
  "coucou"
);
