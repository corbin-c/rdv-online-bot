import nodemailer from "nodemailer";
import "dotenv/config";
import {readFileSync, writeFileSync} from "fs";
import { execSync } from "child_process";
import readline from "readline";

import fetch from "node-fetch";
import { structures, queries } from "./config.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const wait = true;

const question = (text, fallback="") => {
  return new Promise((resolve) => {
    text = "~ "+text;
    text = (fallback.length) ? text+" ("+fallback+")" : text;
    text += "\n    ▸ ";
    rl.question(text, (answer) => {
      setTimeout(() => {
        if (answer.length) {
          resolve(answer);
        } else {
          resolve(fallback);
        }
      }, 300);
    });
  });
};

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
  return new Promise((resolve, reject) => {
    transporter.verify(function (error, success) {
      if (error) {
        reject(error);
      } else {
        console.log("Mail vérifié avec succès !");
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

const geocoding = async (zipcode) => {
  try {
    const endpoint = "https://api-adresse.data.gouv.fr/search/?q=rue&postcode="+zipcode;
    let results = await fetch(endpoint);
    results = await results.json();
    results = results.features[0].geometry.coordinates;
    return results;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const mockFetch = (path, options) => {
  const url = "https://pro.rendezvousonline.fr/api-web/"+path;
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
  const delay = Math.random()*(maxSeconds-minSeconds)+minSeconds;
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
  let id = await mockFetch("auth/session", { method: "GET" });
  id = await id.json();
  id = id.session_id;
  console.log("new session id:", id);
  return id;
}

const getReasonID = async (placeID) => {
  let reasons = await mockFetch("structures/"+placeID+"/services", { method: "GET" });
  reasons = await reasons.json();
  reasons = reasons[0].reasons;
  reasons = reasons.find(e => {
    e = e.name.toLowerCase();
    if (e.includes("demande") || e.includes("dépôt")) {
      let cni = (e.includes("cni") || e.includes("carte nationale d'identité"));
      let passport = e.includes("passeport");
      let double = e.includes("double");
      if (queries.cni && queries.passport && cni && passport && double) {
        return true;
      }
      if (queries.cni && cni && !double) {
        return true;
      }
      if (queries.passport && passport && !double) {
        return true;
      }
    }
    return false;
  });
  try {
    console.log(reasons.name);
    console.log("found reason ID:", reasons.id);
    return reasons.id;
  } catch {
    return false;
  }
}

const unlock = async (sessionID) => {
  const payload = {
    "session_id": sessionID
  };
  let unlock = await mockFetch("availabilities/unlock",
    { method: "PUT", body: JSON.stringify(payload) });
  unlock = await unlock.json();
  console.log(unlock.message);
}

const getAvailabilities = async (placeID, reasonID, sessionID) => {
  const date = (new Date()).toISOString().split("T")[0];
  reasonID = JSON.stringify({ [reasonID.toString()]: 1 });
  const url = "structures/"+placeID+"/availabilities/week?session_id="+sessionID+"&reasons="+reasonID+"&date="+date+"&direction=1";
  let av = await mockFetch(url, { method: "GET" });
  av = await av.json();
  if (av.message) {
    console.warn("something went wrong...", av.message);
    return "2025-12-31";
  }
  av = Object.values(av).filter(e => e.availabilities.length);
  av = av[0].date;
  console.log("best date:", av);
  return av;
}

const getStructures = async (zip, coordinates, radius) => {
  const path = "search-structures/Carte%20Nationale%20d'Identit%C3%A9%20(CNI)%20et%20Passeport/"
  +zip
  +"/"+coordinates[1]
  +"/"+coordinates[0]
  +"?reasons_number={%221%22:1}&sort=asap&radius="
  +radius
  +"&page=1&per_page=100";
  let results = await mockFetch(path, {});
  results = await results.json();
  return results.results.filter(e => {
    if (!e.is_client || !e.reasons.length) {
      return false;
    }
    return true;
  }).map(e => {
    return {
      id: e.id.toString(),
      name: e.name
    }
  });
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
  await randomWait(60, 600);
  const sessionID = await getSessionID();
  for (const place of structures) {
    console.log("working on:", place.name);
    await randomWait(30, 100);
    const reasonID = await getReasonID(place.id);
    if (reasonID !== false) {
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
  }
  writeFileSync("./av.json", JSON.stringify(availabilities), { encoding: "utf-8" });
  if (init) {
    return;
  }
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

const init = async () => {
  console.log("--- Initialisation... ---");
  await main(true);
  console.log("Vérification de la configuration mail...");
  try {
    await verifyMail();
  } catch(e) {
    console.error(`La vérification de la configuration du mail a échoué.
Changez les réglages dans le fichier .env ou réessayez.
`);
    console.error(e);
  }
}

(async () => {
  if (process.argv[2] === "--init") {
    await init();
  } else if (process.argv[2] === "--config") {
    console.log("--- Début de la configuration ---");
    const zipcode = await question("Votre code postal ?", "75001");
    const r = Math.max(5, parseInt(await question("Votre rayon de mobilité ? (en km)", "5")));
    console.log("Vérification des structures proposant des rendez-vous...")
    const coordinates = await geocoding(zipcode);
    console.log("Coordonnées géographiques :", coordinates);
    const structuresFound = await getStructures(zipcode, coordinates, r);
    if (structuresFound.length === 0) {
      console.error("Aucune structure trouvée. Abandon...");
      process.exit();
    }
    const cni = (await question("Voulez-vous une carte d'identité - CNI ? (O/n)", "O")).toLowerCase() === "o";
    const passport = (await question("Voulez-vous un passeport ? (O/n)", "O")).toLowerCase() === "o";
    console.log("Sauvegarde des paramètres de la demande...");
    writeFileSync("./config.js", `const structures = ${JSON.stringify(structuresFound)};

const queries = ${JSON.stringify({cni, passport})};

export {
  queries,
  structures
}`, { encoding: "utf-8" });
    console.log("Pour les alertes, vous devez configurer un serveur de mail sortant (SMTP)");
    const mailServer = await question("Serveur SMTP ?");
    const mailUser = await question("Nom d'utilisateur ?");
    const mailPassword = await question("Mot de passe ?");
    const mailPort = await question("Port ?", "587");
    const mailSecure = (await question("Connexion sécurisée ? (O/n)", "O")).toLowerCase() === "o";
    const mailTo = await question("Destinataire des mails ?");
    const dotEnvFile = `MAILUSER=${mailUser}
MAILPWD=${mailPassword}
MAILHOST=${mailServer}
MAILPORT=${mailPort}
MAILSECURE=${mailSecure}
MAILTO=${mailTo}
`;
    writeFileSync("./.env", dotEnvFile, { encoding: "utf-8" });
    console.log("Configuration mail sauvegardée dans ./.env");
    console.log("\n--- Configuration terminée ---\n")
    const initialize = (await question("Initialiser l'application et tester la configuration mail ? (O/n)", "O")).toLowerCase() === "o";
    const maxDelay = 600+110*structuresFound.length;
    console.log(structuresFound.length
    +" structures ont été trouvées, soit une durée de boucle maximale de "
    +maxDelay
    +" secondes. Définissez un crontab adapté.");
    if (initialize) {
      process.env.MAILUSER = mailUser;
      process.env.MAILPWD = mailPassword;
      process.env.MAILHOST = mailServer;
      process.env.MAILPORT = mailPort;
      process.env.MAILSECURE = mailSecure;
      process.env.MAILTO = mailTo;
      execSync("npm run init", { stdio: "inherit" });
    }
  } else {
    console.log("vérification des rendez-vous...");
    await main();
  }
  process.exit();
})();
