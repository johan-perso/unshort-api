# UnshortAPI

UnshortAPI est une API complètement gratuite et sans clé d'API permettant d'obtenir le lien original d'un lien raccourci. Cette API fonctionne sur la plupart des services de raccourcissement de liens (bit.ly, t.co, is.gd, etc), mais ne fonctionne pas sur les services qui demandent d'effectuer une action pour obtenir le lien original (adf.ly par exemple, Grabify est une exception).


## Vous ne voulez pas de l'API ?

UnshortAPI est aussi utilisable depuis un site web, vous pouvez le trouver [ici](https://unshort.johanstick.me) (son code n'est cependant pas open-source).


## Fonctionnalités

* Obtient le lien original d'un lien raccourci sur la plupart des services de raccourcissement de liens.
* Enregistrement des liens pendant 12 heures dans une base de données pour éviter de les revérifier.
* Vérifie si les liens ne sont pas dangereux avec la [Safe Browsing API de Google](https://transparencyreport.google.com/safe-browsing/search).
* Tente d'obtenir les métadonnées les plus importantes du lien (titre, description, image).


## Prérequis (self-host)

* [nodejs v14+ et npm](https://nodejs.org) installé.
* Un compte Supabase (même gratuit) si vous souhaitez enregistrer les liens dans une base de données.
* Une clé d'API pour la Safe Browsing API de Google (gratuit) si vous souhaitez utiliser la fonctionnalité de vérification des liens.


## Wiki (utilisation de l'API, self-host, etc)

Le wiki est disponible [ici](https://github.com/johan-perso/unshort-api/wiki).


## Tester/déployer

> ⚠️ L'adresse IP de l'hébergeur pourra être lue par les sites web dont vous tentez d'obtenir le lien original.

> Assurez-vous de lire la page du [wiki](https://github.com/johan-perso/unshort-api/wiki/H%C3%A9berger-UnshortAPI) pour mieux comprendre comment héberger votre instance personnalisée.

**Tester :**

[![Open in Stackblitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/johan-perso/unshort-api)

**Héberger :**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjohan-perso%2Funshort-api&project-name=unshort-api&repo-name=unshort-api)


## Licence

MIT © [Johan](https://johanstick.me)
