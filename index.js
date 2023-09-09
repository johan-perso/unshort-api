// Importer quelques librairies
const fetch = require('node-fetch'); process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0 // on s'en fout sah
const fastify = require('fastify')({ logger: { level: 'silent' } })
fastify.register(require('@fastify/cors'))
require('dotenv').config()

// Supabase
var { createClient } = require('@supabase/supabase-js')
var supabase
if(process.env.SUPABASE_LINK && process.env.SUPABASE_PUBLIC_KEY) supabase = createClient(process.env.SUPABASE_LINK, process.env.SUPABASE_PUBLIC_KEY)

// Safe Browsing API
var lookup
async function checkURL(url){
	if(!lookup) lookup = require('safe-browse-url-lookup')({ apiKey: process.env.SAFE_BROWSING_KEY })
	return await lookup.checkSingle(url)
}

// Obtenir certaines métadonnées à partir d'un code HTML
function getMetadata(html){
	// Obtenir le head
	var head = html?.split('<head')?.[1]?.split('</head>')?.[0]
	if(!head) return

	// Filtrer les métadonnées, puis obtenir les plus utiles
	var metadata = head.split('<meta').filter(meta => {
		var isMeta = meta.trim().match(/(?!.*?(ignore|someIgnore))[\s\S]*?\/?>/g)
		if(isMeta) return isMeta.toString()
	}).map(meta => {
		// Obtenir le nom
		meta = meta.trim()
		var name = meta.match(/name="(.*?)"/)?.[1] || meta.match(/property="(.*?)"/)?.[1]

		// Si le nom n'est pas intéressant, on ignore cette métadonnée
		if(!['description', 'title', 'og:title', 'og:description', 'og:image', 'twitter:title', 'twitter:description', 'twitter:image'].includes(name)) return

		// Obtenir un nom plus universel
		if(name == 'og:title' || name == 'twitter:title') name = 'title'
		if(name == 'og:description' || name == 'twitter:description') name = 'description'
		if(name == 'og:image' || name == 'twitter:image') name = 'image'

		// Obtenir et retourner le contenu
		var content = meta.match(/content="(.*?)"/)?.[1]
		if(content && name == 'image' && content.startsWith('://')) content = 'https' + content
		if(name && content) return { name, content }
	}).filter(a => a)

	// Les retourner en supprimant les doublons
	return metadata.filter((v,i,a)=>a.findIndex(t=>(t.name === v.name))===i)
}

// Supprimer les liens trop anciens
async function deleteOldLinks(){
	// Obtenir tout les liens
	if(!supabase) return
	var { data, error } = await supabase.from('unshort-api').select('*')

	// Si on a une erreur, ou pas de données
	if(error) return console.error(error)
	if(!data) return

	// Pour chaque lien
	for(var i = 0; i < data.length; i++){
		// Obtenir le lien
		var link = data[i]
		if(!link || !link?.url) continue // si on a pas l'URL

		// Supprimer le lien s'il est trop ancien
		if(new Date(link.expiration) < new Date()){
			var { error } = await supabase.from('unshort-api').delete().match({ url: link.url })
			if(error) console.error(error)
		}
	}
}
deleteOldLinks()
setInterval(async () => {
	deleteOldLinks()
}, 1000 * 60 * 60 * 12)

// Simplifier une URL en enlevant certains caractères
function simplifyURL(string){
	if(string.endsWith('/')) string = string.slice(0, -1)
	if(string.startsWith('https://')) string = string.replace('https://','')
	if(string.startsWith('http://')) string = string.replace('http://','')
	if(string.startsWith('www.')) string = string.replace('www.','')
	return string
}

// Obtenir une URL à partir d'une balise meta refresh
function extractUrlFromMetaString(string){
	var regex = /<meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)["']\s*\/?>/i
	var match = regex.exec(string)
	if(!match){
		regex = /<meta\s+content=["']\d+;\s*url=([^"']+)["']\s+http-equiv=["']refresh["']\s*\/?>/i
		match = regex.exec(string)
	}
	return match ? match[1] : null
}

// Obtenir le lien original depuis Grabify
async function getGrabifyURL(link){
	// Faire une première requête pour obtenir certaines variables
	var controller = new AbortController()
	var timeout = setTimeout(() => controller.abort(), process.env.REQUEST_TIMEOUT || 8000)
	var data = await fetch(link, {
		signal: controller.signal,
		headers: {
			'User-Agent': 'UnshortSTI/0.0 (deso pas deso)',
			'referer': 'https://unshort.johanstick.fr',
		},
		redirect: 'follow'
	}).catch(() => null)
	clearTimeout(timeout)

	// Préparer les données qu'on va utiliser
	data = {
		cookies: data.headers.get('set-cookie'),
		text: await data.text()
	}
	
	// Obtenir les variables nécessaires
	data['_token'] = data.text.match(/<input type="hidden" name="_token" value="(.*?)">/)?.[1]
	data['special_id'] = data.text.match(/<input type="hidden" id="special_id" name="special_id" value="(.*?)">/)?.[1]

	// Si on a pas les variables nécessaires, on annule
	if(!data._token || !data.special_id) return ''
console.log(data)
	// Faire une seconde requête pour obtenir le lien original
	var controller = new AbortController()
	var timeout = setTimeout(() => controller.abort(), process.env.REQUEST_TIMEOUT || 8000)
	var redirected = await fetch(link, {
		method: 'POST',
		signal: controller.signal,
		headers: {
			'cookie': `${data.cookies?.split('; expires')[0]}; g_session=${data.cookies?.split('g_session=')[1].split(';')[0]}`,
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
			'user-agent': 'UnshortSTI/0.0 (deso pas deso)',
			'referer': 'https://unshort.johanstick.fr',
		},
		body: new URLSearchParams({ tos_accepted: 1, privacy_accepted: 1, _token: data._token, special_id: data.special_id }),
		redirect: 'manual'
	}).catch(() => null)

	// Retourner le lien si on l'a
	return redirected.headers.get('location') || ''
}

// Faire une ou plusieurs requêtes pour tenter d'obtenir l'URL original
async function getOriginalURL(id, link, oldLink){
	// Si on doit s'arrêter
	if(global[id] == 'stop') return null

	// Obtenir le domaine
	var domain = link?.split('/')?.[2]
	if(!domain) return { statusCode: 400, error: 'Invalid Link', message: 'Oups, le lien est invalide.' }

	// Faire une requête
	var controller = new AbortController()
	var timeout = setTimeout(() => controller.abort(), process.env.REQUEST_TIMEOUT || 8000)
	var redirected = await fetch(link, {
		signal: controller.signal,
		headers: {
			'User-Agent': domain == 'grabify.link' ? 'UnshortSTI/0.0 (deso pas deso)' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
			'cookie': domain == 'v.gd' || domain == 'is.gd' ? `preview=${domain == 'v.gd' ? 1 : domain == 'is.gd' ? 0 : null}` : '',
			'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
			'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
			'Upgrade-Insecure-Requests': '1',
			'Cache-Control': 'max-age=0'
		},
		redirect: 'follow'
	}).catch(() => null)
	clearTimeout(timeout)

	// Ajouter +1 au nombre de requêtes faites
	if(!global[id + '_r']) global[id + '_r'] = 1
	else global[id + '_r']++

	// Si on doit s'arrêter
	if(global[id] == 'stop') return null

	// Obtenir le contenu de la page
	var content = await redirected?.text()

	// Préparer une variable
	var potentialWarning

	// Si la page comporte un challenge Cloudflare
	if(content?.includes('<noscript><div id="challenge-error-title"><div class="h2"><span class="icon-wrapper"><div class="heading-icon warning-icon"></div></span><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></div></noscript>')){
		potentialWarning = "La vérification n'a pas pu être complétée à cause d'une vérification anti-robot qu'Unshort n'a pas pu passer."
	}

	// Obtenir le lien après redirection
	var redirectionMethod
	if(redirected?.url && simplifyURL(redirected.url) != simplifyURL(link)){
		redirected = redirected.url
		redirectionMethod = 'redirected'
	}
	else if(content?.includes(`By clicking continue you agree to the <a target="_blank" href="https://grabify.link/tos">TOS</a> and`)){ // Grabify
		redirected = await getGrabifyURL(link)
		if(redirected) redirectionMethod = 'grabify'
	}
	else if(content){ // YouTube
		var youtube = content.match(/<a id="invalid-token-redirect-goto-site-button" role="button" href="(.*?)">Accéder au site<\/a>/)
		if(youtube){
			redirected = youtube[1]
			redirectionMethod = 'youtube'
		}
	}
	if(!redirectionMethod && redirected){ // ne pas mettre un "else" ici
		redirected = extractUrlFromMetaString(content) // pour certains liens comme t.co
		redirectionMethod = 'meta' // même si on a pas pu obtenir le lien, c'est voulu
	}

	// Si on a pas le contenu de cette page, mais qu'on avait déjà le lien, on retourne l'ancien lien
	if(!redirected && oldLink) return { r: oldLink, c: content, w: potentialWarning }

	// Si on avait déjà ce lien, on le retourne
	if(redirected && typeof redirected == 'string' && oldLink && simplifyURL(redirected) == simplifyURL(oldLink)) return { r: oldLink, c: content, w: potentialWarning }

	// Si on a pas obtenu le lien à partir d'une redirection, on vérifie le lien qu'on vient d'obtenir
	if(redirected && redirectionMethod != 'redirected') return await getOriginalURL(id, redirected, redirected)

	// On finit par retourner le lien (j'sais même pas si ce code est utile, mais bon)
	return { r: redirected, c: content, w: potentialWarning }
}

// Rediriger vers la documentation
fastify.get('/', async (req, res) => {
	return res.redirect("https://github.com/johan-perso/unshort-api/wiki/Utilisation-de-l'API")
})

// Obtenir un lien original
fastify.post('/', async (req, res) => {
	// Obtenir le lien
	var link
	try {
		link = JSON.parse(req.body).link || req.body?.link || req.query.link
	} catch(e) {
		link = req.body?.link || req.query.link
	}
	if(!link?.length) throw { statusCode: 400, error: 'No Link', message: 'Vous devez entrer la valeur "link" via les paramètres (query) ou un body JSON.' }

	// Vérifier si le lien est dans la base de données
	if(supabase){
		var { data, error } = await supabase.from('unshort-api').select('*').match({ url: link })
		if(error){
			console.log(error)
			throw { statusCode: 502, error: 'Database Error Check', message: 'Une erreur est survenue avec la base de données lors de la vérification sur la BDD.' }
		}
		if(data?.[0]){
			if(new Date(data[0].expiration) < new Date()) var { error } = await supabase.from('unshort-api').delete().eq('url', link)
			else {
				data[0].metadata = data[0].metadata || []
				return data[0]
			}
		}
	}

	// Obtenir le lien original
		// Générer un identifiant unique
		var id = Date.now()

		// Définir un temps maximum
		var timeout = setTimeout(() => {
			global[id] = 'stop' // Définir que l'identifiant doit s'arrêter, ça sera vérifier par la fonction
			return res.status(504).send({ statusCode: 504, error: 'Timeout', message: `Le lien a mis trop de temps à répondre (${global[id + '_r'] || 1} requêtes).` })
		}, process.env.REQUEST_TIMEOUT || 8000)

		// Obtenir le lien via une fonction dédiée
		var redirected = await getOriginalURL(id, link)
		clearTimeout(timeout) // Arrêter le timeout
		delete global[id] // Supprimer l'identifiant
		if(redirected && redirected?.error) throw redirected // Si la fonction nous a retourné une erreur, on la retourne

		// Séparer les informations
		var content = redirected?.c
		var potentialWarning = redirected?.w
		redirected = redirected?.r

		// Si on a pas le lien redirigé
		if(!redirected) throw { statusCode: 302, error: 'Unsupported Link', message: potentialWarning || 'Ce lien n\'est pas supporté par notre service.' }

	// Vérifier si le lien est safe
	var isSafe
	if(process.env.SAFE_BROWSING_KEY) isSafe = !(await checkURL(redirected))

	// Obtenir les métadonnées
	var metadata = await getMetadata(content)

	// Ajouter le lien à la base de données
	if(supabase){
		var { error } = await supabase.from('unshort-api').insert([{ url: link, redirected, safe: isSafe, metadata, expiration: new Date(Date.now() + 1000 * 60 * 60 * 12) }])
		if(error){
			console.log(error)
			throw { statusCode: 502, error: 'Database Error Insert', message: 'Une erreur est survenue avec la base de données lors de l\'ajout du lien. Veuillez réessayer.' }
		}
	}

	// Retourner le lien
	return { url: link, redirected, safe: isSafe, potentialWarning, metadata }
})

// Démarrer le serveur
fastify.listen({ port: process.env.PORT || 3000 }, (err) => {
	if(err) fastify.log.error(err), process.exit(1)
	console.log(`Server listening on port ${fastify.server.address().port}`)
})
