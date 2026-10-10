// Tiny dependency-free i18n for the anonymous /book page (English + French).
import { ref } from 'vue'

const STORAGE_KEY = 'bookins.guest.locale'
export const SUPPORTED = ['en', 'fr']

const en = {
  'header.secure': 'Secure booking page',
  'header.demo': 'Demo guest preview',
  'lang.label': 'Language',
  'demo.title': 'Demo · guest preview',
  'demo.text': 'These services and times are fictional. This preview cannot create a reservation or show a booking success.',
  'loading.title': 'Opening the booking page…',
  'loading.text': 'Checking services and available times.',
  'retry': 'Try again',
  'host.fallback': 'host',

  'err.link.title': 'This booking link is no longer valid.',
  'err.link.text': 'It may have expired or been turned off. Ask the host for a new booking link.',
  'err.runtime.title': 'Booking is not available here right now.',
  'err.runtime.text': 'This page could not connect to the booking service. Open it from the host’s booking link, then try again.',
  'err.notReady.title': 'This booking page is not ready yet.',
  'err.notReady.text': 'The host has not finished setting it up. Please check back later or contact them directly.',
  'err.network.title': 'We could not reach the booking service.',
  'err.network.text': 'Check your internet connection and try again. We will also retry once when you are back online.',
  'err.generic.title': 'We could not load this booking page.',
  'err.generic.text': 'Try again in a moment, or ask the host for a new booking link.',

  'err.serviceGone': 'This service is no longer available. Choose another service.',
  'err.noSchedule': 'This service has no bookable times right now. Choose another service or check back later.',
  'err.networkRange': 'Could not reach the booking service. Check your connection and try again. We will retry once when you are back online.',
  'err.timeoutRange': 'Availability took too long to load. Try again.',
  'err.availability': 'Availability could not load. Try again.',

  'confirm.eyebrow': 'Booking recorded',
  'confirm.title': 'You are booked.',
  'confirm.copy': 'Your time with {host} is recorded. Keep the reference below.',
  'confirm.hostTime': 'Host’s time: {time} ({zone})',
  'confirm.reference': 'Reference',
  'confirm.duration': 'Duration',
  'confirm.minutes': '{count} minutes',
  'confirm.ics': 'Download .ics file',
  'confirm.google': 'Add to Google Calendar',
  'confirm.note': 'These buttons create the event on your device only. Bookins does not send a confirmation email, add this to your calendar for you, or take online payment in this release. Save your reference, because it is not shown again after you leave this page.',

  'host.eyebrow': 'Book a session with',
  'tz.shownIn': 'Times shown in',
  'tz.shownInZone': 'Times shown in {zone}',
  'tz.guest': 'your time zone: {zone}',
  'tz.owner': 'host’s time zone: {zone}',

  'steps.aria': 'Booking progress',
  'steps.service': 'Service',
  'steps.time': 'Time',
  'steps.details': 'Details',
  'steps.done': 'Done',
  'confirm.copyRef': 'Copy',
  'confirm.copied': 'Copied',
  'confirm.copyAria': 'Copy booking reference',
  'confirm.another': 'Book another time',
  'steps.of': 'Step {n} of 4',
  'back': 'Back',

  'svc.title': 'Choose a service',
  'svc.text': 'Select the session that best fits what you need.',
  'svc.min': '{count} min',
  'svc.free': 'Free',
  'svc.emptyTitle': 'No services are open for booking',
  'svc.emptyText': '{host} has no services available right now. Please check back later or contact them directly.',

  'time.title': 'Choose a date and time',
  'time.sub': '{service} · {count} minutes',
  'cal.aria': 'Choose a date',
  'cal.prev': 'Previous month',
  'cal.next': 'Next month',
  'cal.dayTimes_one': '{day}, {count} time available',
  'cal.dayTimes_other': '{day}, {count} times available',
  'cal.dayNone': '{day}, no times available',
  'cal.noTimes': 'No open times',
  'cal.zone': 'Times in {zone}',
  'cal.legend': 'Greyed-out days have no open times. The host may need advance notice, may be fully booked, or may be closed that day.',
  'cal.checking': 'Checking the host’s Google Calendar for conflicts…',
  'cal.degraded': 'The host’s Google Calendar could not be checked. These times reflect Bookins bookings, but a Calendar conflict may still exist.',
  'cal.unavailable': 'Google Calendar conflict checking is not available for this booking page. Times reflect Bookins bookings.',
  'cal.retry': 'Retry Calendar check',
  'slots.loading': 'Checking available times…',
  'slots.on': 'Times on {day}',
  'slots.heading_one': '{day} · {count} time',
  'slots.heading_other': '{day} · {count} times',
  'slots.pickDayTitle': 'Select a highlighted day',
  'slots.pickDayText': 'Days with open times are highlighted in the calendar.',
  'slots.searching': 'Looking for the next opening…',
  'slots.noneInMonth': 'No times in {month}',
  'slots.nextDay': 'The next available day is {date}.',
  'slots.goNext': 'Go to next available',
  'slots.noneTitle': 'No openings available',
  'slots.noneText': 'There are no open times in the coming months. Please check back later or contact {host}.',

  'form.title': 'Tell us about you',
  'form.titleDemo': 'Preview guest details',
  'form.text': 'We will use these details only for this booking.',
  'form.textDemo': 'Use fictional details to explore this form. Nothing is sent or booked.',
  'form.name': 'Full name',
  'form.namePh': 'Your name',
  'form.email': 'Email address',
  'form.emailPh': 'you@example.com',
  'form.phone': 'Phone number',
  'form.optional': 'Optional',
  'form.phonePh': '+234 800 000 0000',
  'form.phoneHint': 'Add a phone number so {host} can reach you on WhatsApp or SMS about this appointment.',
  'form.notes': 'Anything the host should know?',
  'form.notesPh': 'Share a little context for the session.',
  'form.submit': 'Confirm booking',
  'form.submitUnchecked': 'Confirm without Calendar check',
  'form.submitting': 'Confirming your booking…',
  'form.submitDemo': 'Reservations unavailable in Demo',
  'form.fine': 'Your booking is shown on this screen. Bookins does not send email, add to your calendar, or take payment in this release.',
  'form.fineDemo': 'Demo does not submit these details or create a booking.',
  'form.errName': 'Enter your name.',
  'form.errEmailEmpty': 'Enter your email address.',
  'form.errEmail': 'Enter a valid email address, like you@example.com.',
  'form.errPhone': 'Enter a valid phone number, or leave this blank.',
  'form.srvEmail': 'Check this email address.',
  'form.srvName': 'Check your name.',
  'form.srvPhone': 'Check this phone number.',

  'clock.aria': 'Time format',
  'confirm.what': 'What',
  'confirm.when': 'When',
  'confirm.who': 'With',
  'sum.eyebrow': 'Your booking',
  'sum.duration': 'Duration',
  'sum.price': 'Price',
  'sum.time': 'Time',
  'sum.payment': 'Payment is arranged directly with the host.',
  'sum.with': 'With {host}',
  'footer': 'Simple scheduling for African businesses.',

  'banner.slotTaken': 'That time was just booked by someone else. The times below are refreshed, so pick another. Your details are saved.',
  'banner.calendarBusy': 'That time now conflicts with the host’s calendar. Pick another time. Your details are saved.',
  'banner.calendarUnchecked': 'We still could not check the host’s Google Calendar. Review the warning below, then confirm again to book using Bookins availability only.',
  'banner.uncertainTaken': 'This time is no longer open. Your earlier attempt may have gone through and be holding it. Please contact the host to confirm before booking another time.',
  'banner.contact': 'Some of your details need a second look. Your selected time is still held in this form.',
  'banner.serviceGone': 'That service is no longer available for booking. Choose another service, or contact the host.',
  'banner.cannotBook': 'This service cannot be booked online right now. Please contact the host directly.',
  'banner.retryNetwork': 'We could not reach the booking service, so we are not sure whether your booking went through. Your time is still selected. Press Confirm booking to retry; it will not create a duplicate.',
  'banner.retryOther': 'Something went wrong and we could not confirm your booking. Your time is still selected. Press Confirm booking to try again; it will not create a duplicate.',
  'banner.demo': 'Reservations are disabled in the Demo guest preview.',

  'svc.search': 'Search services or categories',
  'svc.searchHint': 'Search services',
  'svc.noMatch': 'No services match “{query}”.',
  'svc.count_one': '{count} service found',
  'svc.count_other': '{count} services found',
  'svc.other': 'Other',
  'svc.prep': 'Before you come: {notes}',
  'svc.from': 'from {price}',
  'svc.team_other': '{count} professionals',
  'svc.pickWho': 'Choose who to book with',
  'team.option': 'Professional {n}',
  'team.host': 'With the host',

  'view.aria': 'Calendar view',
  'view.month': 'Month',
  'view.week': 'Week',
  'view.column': 'Column',
  'cal.prevRange': 'Earlier dates',
  'cal.nextRange': 'Later dates',
  'cal.pickDate': 'Month',
  'cal.pickDateAria': 'Pick a date from the month calendar',
  'cal.close': 'Close',
  'cal.rangeAria': 'Available times by day',
  'cols.none': 'No times',
  'cols.slotAria': '{day}, {time}',
  'slots.nextChip': 'Next available: {when}',
  'slots.dayEmpty': 'No times on {day}.',
  'slots.continue': 'Continue',
  'slots.picked': 'Selected: {when}',

  'tz.label': 'Time zone',
  'tz.search': 'Search time zones',
  'tz.noMatch': 'No matching time zone',
  'tz.device': 'your device',
  'tz.host': 'host',
  'tz.change': 'Time zone: {zone}. Change',

  'confirm.shareWa': 'Share on WhatsApp',
  'confirm.copyDetails': 'Copy details',
  'confirm.detailsCopied': 'Details copied',
  'confirm.change': 'To change this, message {host} on WhatsApp.',
  'confirm.changeCta': 'Message {host}',
  'share.text': '{service} with {host}\n{when}\nReference: {reference}',
  'share.changeText': 'Hello, I would like to change my booking {reference}.',

  'ics.summary': '{service} with {host}',
  'ics.description': 'Booking reference: {reference}',
}

const fr = {
  'header.secure': 'Page de réservation sécurisée',
  'header.demo': 'Aperçu invité de la démo',
  'lang.label': 'Langue',
  'demo.title': 'Démo · aperçu invité',
  'demo.text': 'Ces services et ces horaires sont fictifs. Cet aperçu ne peut ni créer de réservation ni afficher de confirmation.',
  'loading.title': 'Ouverture de la page de réservation…',
  'loading.text': 'Recherche des services et des horaires disponibles.',
  'retry': 'Réessayer',
  'host.fallback': 'l’hôte',

  'err.link.title': 'Ce lien de réservation n’est plus valide.',
  'err.link.text': 'Il a peut-être expiré ou été désactivé. Demandez un nouveau lien de réservation à l’hôte.',
  'err.runtime.title': 'La réservation n’est pas disponible ici pour le moment.',
  'err.runtime.text': 'Cette page n’a pas pu se connecter au service de réservation. Ouvrez-la depuis le lien de réservation de l’hôte, puis réessayez.',
  'err.notReady.title': 'Cette page de réservation n’est pas encore prête.',
  'err.notReady.text': 'L’hôte n’a pas fini de la configurer. Revenez plus tard ou contactez-le directement.',
  'err.network.title': 'Impossible de joindre le service de réservation.',
  'err.network.text': 'Vérifiez votre connexion Internet et réessayez. Nous réessaierons aussi une fois dès que vous serez de nouveau en ligne.',
  'err.generic.title': 'Impossible de charger cette page de réservation.',
  'err.generic.text': 'Réessayez dans un instant ou demandez un nouveau lien de réservation à l’hôte.',

  'err.serviceGone': 'Ce service n’est plus disponible. Choisissez un autre service.',
  'err.noSchedule': 'Ce service n’a aucun horaire réservable pour le moment. Choisissez un autre service ou revenez plus tard.',
  'err.networkRange': 'Impossible de joindre le service de réservation. Vérifiez votre connexion et réessayez. Nous réessaierons une fois dès que vous serez de nouveau en ligne.',
  'err.timeoutRange': 'Le chargement des disponibilités a pris trop de temps. Réessayez.',
  'err.availability': 'Impossible de charger les disponibilités. Réessayez.',

  'confirm.eyebrow': 'Réservation enregistrée',
  'confirm.title': 'Votre réservation est confirmée.',
  'confirm.copy': 'Votre rendez-vous avec {host} est enregistré. Conservez la référence ci-dessous.',
  'confirm.hostTime': 'Heure de l’hôte : {time} ({zone})',
  'confirm.reference': 'Référence',
  'confirm.duration': 'Durée',
  'confirm.minutes': '{count} minutes',
  'confirm.ics': 'Télécharger le fichier .ics',
  'confirm.google': 'Ajouter à Google Agenda',
  'confirm.note': 'Ces boutons créent l’événement uniquement sur votre appareil. Dans cette version, Bookins n’envoie pas d’e-mail de confirmation, n’ajoute pas ce rendez-vous à votre agenda à votre place et ne prend aucun paiement en ligne. Notez votre référence : elle ne sera plus affichée une fois que vous aurez quitté cette page.',

  'host.eyebrow': 'Réserver une séance avec',
  'tz.shownIn': 'Heures affichées en',
  'tz.shownInZone': 'Heures affichées en {zone}',
  'tz.guest': 'votre fuseau horaire : {zone}',
  'tz.owner': 'fuseau horaire de l’hôte : {zone}',

  'steps.aria': 'Progression de la réservation',
  'steps.service': 'Service',
  'steps.time': 'Horaire',
  'steps.details': 'Coordonnées',
  'steps.done': 'Terminé',
  'confirm.copyRef': 'Copier',
  'confirm.copied': 'Copié',
  'confirm.copyAria': 'Copier la référence de réservation',
  'confirm.another': 'Réserver un autre horaire',
  'steps.of': 'Étape {n} sur 4',
  'back': 'Retour',

  'svc.title': 'Choisissez un service',
  'svc.text': 'Sélectionnez la séance qui correspond le mieux à votre besoin.',
  'svc.min': '{count} min',
  'svc.free': 'Gratuit',
  'svc.emptyTitle': 'Aucun service n’est ouvert à la réservation',
  'svc.emptyText': '{host} n’a aucun service disponible pour le moment. Revenez plus tard ou contactez-le directement.',

  'time.title': 'Choisissez une date et une heure',
  'time.sub': '{service} · {count} minutes',
  'cal.aria': 'Choisissez une date',
  'cal.prev': 'Mois précédent',
  'cal.next': 'Mois suivant',
  'cal.dayTimes_one': '{day}, {count} horaire disponible',
  'cal.dayTimes_other': '{day}, {count} horaires disponibles',
  'cal.dayNone': '{day}, aucun horaire disponible',
  'cal.noTimes': 'Aucun horaire libre',
  'cal.zone': 'Horaires en {zone}',
  'cal.legend': 'Les jours grisés n’ont aucun horaire libre. L’hôte peut demander un préavis, être complet ou fermé ce jour-là.',
  'cal.checking': 'Vérification des conflits dans le Google Agenda de l’hôte…',
  'cal.degraded': 'Le Google Agenda de l’hôte n’a pas pu être vérifié. Ces horaires tiennent compte des réservations Bookins, mais un conflit peut encore exister.',
  'cal.unavailable': 'La vérification des conflits Google Agenda n’est pas disponible sur cette page. Les horaires tiennent compte des réservations Bookins.',
  'cal.retry': 'Revérifier Google Agenda',
  'slots.loading': 'Recherche des horaires disponibles…',
  'slots.on': 'Horaires du {day}',
  'slots.heading_one': '{day} · {count} horaire',
  'slots.heading_other': '{day} · {count} horaires',
  'slots.pickDayTitle': 'Sélectionnez un jour en surbrillance',
  'slots.pickDayText': 'Les jours avec des horaires disponibles sont mis en évidence dans le calendrier.',
  'slots.searching': 'Recherche de la prochaine disponibilité…',
  'slots.noneInMonth': 'Aucun horaire en {month}',
  'slots.nextDay': 'Le prochain jour disponible est le {date}.',
  'slots.goNext': 'Aller à la prochaine disponibilité',
  'slots.noneTitle': 'Aucune disponibilité',
  'slots.noneText': 'Il n’y a aucun horaire disponible dans les mois à venir. Revenez plus tard ou contactez {host}.',

  'form.title': 'Dites-nous qui vous êtes',
  'form.titleDemo': 'Aperçu des coordonnées de l’invité',
  'form.text': 'Nous utiliserons ces informations uniquement pour cette réservation.',
  'form.textDemo': 'Utilisez des coordonnées fictives pour explorer ce formulaire. Rien n’est envoyé ni réservé.',
  'form.name': 'Nom complet',
  'form.namePh': 'Votre nom',
  'form.email': 'Adresse e-mail',
  'form.emailPh': 'vous@exemple.com',
  'form.phone': 'Numéro de téléphone',
  'form.optional': 'Facultatif',
  'form.phonePh': '+225 07 00 00 00 00',
  'form.phoneHint': 'Ajoutez un numéro pour que {host} puisse vous joindre par WhatsApp ou SMS au sujet de ce rendez-vous.',
  'form.notes': 'Quelque chose à signaler à l’hôte ?',
  'form.notesPh': 'Donnez un peu de contexte pour la séance.',
  'form.submit': 'Confirmer la réservation',
  'form.submitUnchecked': 'Confirmer sans vérification de l’agenda',
  'form.submitting': 'Confirmation de votre réservation…',
  'form.submitDemo': 'Réservation indisponible dans la démo',
  'form.fine': 'Votre réservation s’affiche sur cet écran. Dans cette version, Bookins n’envoie pas d’e-mail, n’ajoute rien à votre agenda et ne prend aucun paiement.',
  'form.fineDemo': 'La démo n’envoie pas ces informations et ne crée aucune réservation.',
  'form.errName': 'Saisissez votre nom.',
  'form.errEmailEmpty': 'Saisissez votre adresse e-mail.',
  'form.errEmail': 'Saisissez une adresse e-mail valide, par exemple vous@exemple.com.',
  'form.errPhone': 'Saisissez un numéro de téléphone valide ou laissez ce champ vide.',
  'form.srvEmail': 'Vérifiez cette adresse e-mail.',
  'form.srvName': 'Vérifiez votre nom.',
  'form.srvPhone': 'Vérifiez ce numéro de téléphone.',

  'clock.aria': 'Format de l’heure',
  'confirm.what': 'Quoi',
  'confirm.when': 'Quand',
  'confirm.who': 'Avec',
  'sum.eyebrow': 'Votre réservation',
  'sum.duration': 'Durée',
  'sum.price': 'Prix',
  'sum.time': 'Horaire',
  'sum.payment': 'Le paiement se règle directement avec l’hôte.',
  'sum.with': 'Avec {host}',
  'footer': 'Une planification simple pour les entreprises africaines.',

  'banner.slotTaken': 'Cet horaire vient d’être réservé par quelqu’un d’autre. Les horaires ci-dessous sont actualisés : choisissez-en un autre. Vos informations sont conservées.',
  'banner.calendarBusy': 'Cet horaire est maintenant en conflit avec l’agenda de l’hôte. Choisissez un autre horaire. Vos informations sont conservées.',
  'banner.calendarUnchecked': 'Le Google Agenda de l’hôte reste indisponible. Lisez l’avertissement ci-dessous, puis confirmez à nouveau pour réserver selon les disponibilités Bookins uniquement.',
  'banner.uncertainTaken': 'Cet horaire n’est plus disponible. Votre tentative précédente a peut-être abouti et le retient. Veuillez contacter l’hôte pour confirmer avant de réserver un autre horaire.',
  'banner.contact': 'Certaines de vos informations méritent d’être vérifiées. L’horaire choisi reste conservé dans ce formulaire.',
  'banner.serviceGone': 'Ce service n’est plus disponible à la réservation. Choisissez un autre service ou contactez l’hôte.',
  'banner.cannotBook': 'Ce service ne peut pas être réservé en ligne pour le moment. Veuillez contacter l’hôte directement.',
  'banner.retryNetwork': 'Nous n’avons pas pu joindre le service de réservation et ne savons donc pas si votre réservation a abouti. Votre horaire reste sélectionné. Appuyez sur « Confirmer la réservation » pour réessayer ; aucun doublon ne sera créé.',
  'banner.retryOther': 'Une erreur s’est produite et nous n’avons pas pu confirmer votre réservation. Votre horaire reste sélectionné. Appuyez sur « Confirmer la réservation » pour réessayer ; aucun doublon ne sera créé.',
  'banner.demo': 'Les réservations sont désactivées dans l’aperçu invité de la démo.',

  'svc.search': 'Rechercher un service ou une catégorie',
  'svc.searchHint': 'Rechercher un service',
  'svc.noMatch': 'Aucun service ne correspond à « {query} ».',
  'svc.count_one': '{count} service trouvé',
  'svc.count_other': '{count} services trouvés',
  'svc.other': 'Autres',
  'svc.prep': 'Avant de venir : {notes}',
  'svc.from': 'dès {price}',
  'svc.team_other': '{count} professionnels',
  'svc.pickWho': 'Choisissez avec qui réserver',
  'team.option': 'Professionnel {n}',
  'team.host': 'Avec l’hôte',

  'view.aria': 'Affichage du calendrier',
  'view.month': 'Mois',
  'view.week': 'Semaine',
  'view.column': 'Colonnes',
  'cal.prevRange': 'Dates précédentes',
  'cal.nextRange': 'Dates suivantes',
  'cal.pickDate': 'Mois',
  'cal.pickDateAria': 'Choisir une date dans le calendrier du mois',
  'cal.close': 'Fermer',
  'cal.rangeAria': 'Horaires disponibles par jour',
  'cols.none': 'Aucun horaire',
  'cols.slotAria': '{day}, {time}',
  'slots.nextChip': 'Prochaine disponibilité : {when}',
  'slots.dayEmpty': 'Aucun horaire le {day}.',
  'slots.continue': 'Continuer',
  'slots.picked': 'Choisi : {when}',

  'tz.label': 'Fuseau horaire',
  'tz.search': 'Rechercher un fuseau horaire',
  'tz.noMatch': 'Aucun fuseau horaire correspondant',
  'tz.device': 'votre appareil',
  'tz.host': 'hôte',
  'tz.change': 'Fuseau horaire : {zone}. Modifier',

  'confirm.shareWa': 'Partager sur WhatsApp',
  'confirm.copyDetails': 'Copier les détails',
  'confirm.detailsCopied': 'Détails copiés',
  'confirm.change': 'Pour modifier ce rendez-vous, écrivez à {host} sur WhatsApp.',
  'confirm.changeCta': 'Écrire à {host}',
  'share.text': '{service} avec {host}\n{when}\nRéférence : {reference}',
  'share.changeText': 'Bonjour, je souhaite modifier ma réservation {reference}.',

  'ics.summary': '{service} avec {host}',
  'ics.description': 'Référence de réservation : {reference}',
}

const dictionaries = { en, fr }

function readStored() {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY)
    return SUPPORTED.includes(value) ? value : ''
  } catch {
    return ''
  }
}

function detect() {
  const stored = readStored()
  if (stored) return stored
  const list = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || []
  for (const entry of list) {
    const base = String(entry || '').toLowerCase().split('-')[0]
    if (base === 'fr') return 'fr'
    if (base === 'en') return 'en'
  }
  return 'en'
}

export const locale = ref('en')

function applyHtmlLang(value) {
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = value
  } catch { /* non-DOM environment */ }
}

/** Resolves the initial locale (stored choice, else navigator.languages) and sets <html lang>. */
export function initLocale() {
  locale.value = detect()
  applyHtmlLang(locale.value)
  return locale.value
}

export function setLocale(value) {
  if (!SUPPORTED.includes(value)) return
  locale.value = value
  applyHtmlLang(value)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value)
  } catch { /* storage blocked: the choice just is not remembered */ }
}

/** BCP-47 tag for Intl: keeps a regional browser tag of the same language (fr-CI, en-NG), else the bare language. */
export function intlLocale() {
  const list = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || []
  const match = list.find(entry => String(entry || '').toLowerCase().split('-')[0] === locale.value)
  return match || locale.value
}

/** t(key, vars). With vars.count, prefers `key_one` / `key_other` (French treats 0 and 1 as singular). */
export function t(key, vars = {}) {
  const dict = dictionaries[locale.value] || en
  let template
  if (typeof vars.count === 'number') {
    const singular = locale.value === 'fr' ? Math.abs(vars.count) < 2 : vars.count === 1
    template = dict[`${key}_${singular ? 'one' : 'other'}`]
  }
  template ??= dict[key] ?? en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`))
}
