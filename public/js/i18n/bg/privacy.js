// Bulgarian catalog, area 'privacy': the same keys and {params} as en/privacy.js.
export default {
  // ---- Settings > Farm (ui/privacy.js)
  'privacy.title': 'Поверителност',
  'privacy.row': 'Твоите данни',
  'privacy.link': 'Прочети бележката',
  'privacy.help.multi': 'Какво пази този сайт за теб, колко дълго и как да поискаш копие или изтриване.',
  'privacy.help.single': 'Този сървър пази фермата ти на собствения си компютър; нищо не отива другаде.',
  'privacy.delete.row': 'Изтриване на фермата',
  'privacy.delete.button': 'Изтрий фермата сега…',
  'privacy.delete.help': 'Всичко в нея изчезва веднага, и за двама ви. Това не може да се отмени.',
  // ---- the confirm (ui/dialogs.js confirm: "Keep my farm" has the focus)
  'privacy.delete.confirm.title': 'Изтриваш фермата?',
  'privacy.delete.confirm.lead': 'Всичко във фермата „{farm}“ изчезва, и за двама ви.',
  'privacy.delete.confirm.leadNoName': 'Всичко в тази ферма изчезва, и за двама ви.',
  'privacy.delete.confirm.body': 'Нивите, животните, сградите, двамата фермери с целия им напредък и всички резервни копия се изтриват веднага. Никой не може да ги върне, дори ние.',
  'privacy.delete.confirm.ok': 'Изтрий я завинаги',
  'privacy.delete.confirm.cancel': 'Запази фермата',
  'privacy.delete.confirm.fine': 'Ако другият фермер играе в момента, ще види на екрана си, че фермата е изтрита.',
  'privacy.delete.err.AUTH': 'Това устройство не може да изтрие тази ферма. Първо отвори личния си линк към фермата.',
  'privacy.delete.err.RATE': 'От тази мрежа току-що бяха изтрити много ферми. Опитай пак малко по‑късно.',
  'privacy.delete.err.NET': 'Фермата не отговори, така че нищо не е изтрито. Опитай пак след малко.',
  // ---- the gate of a deleted farm, and every gate's privacy link (ui/farm-gate.js)
  'privacy.gate.deleted.title': 'Тази ферма е изтрита',
  'privacy.gate.deleted.lead': 'Някой от фермерите ѝ я изтри заедно с всичко в нея. Благодарим ти, че стопанисваше тук! Нова ферма се прави с едно докосване.',
  'privacy.gate.link': 'Поверителност',
  // ---- the privacy page's script (js/privacy.js; the page's own text is public/privacy.html, in both languages)
  'privacy.page.err.kind': 'Избери какво искаш.',
  'privacy.page.err.short': 'Още няколко думи, моля: поне {min} знака.',
  'privacy.page.err.long': 'Това е над {max} знака. Можеш ли да го съкратиш малко?',
  'privacy.page.err.contact': 'Контакт до {max} знака, моля.',
  'privacy.page.sending': 'Изпращаме…',
  'privacy.page.send': 'Изпрати запитването',
  'privacy.page.err.RATE': 'Твърде много запитвания от тази мрежа точно сега. Опитай пак след малко.',
  'privacy.page.err.FULL': 'Твърде много запитвания за днес. Опитай пак утре.',
  'privacy.page.err.BAD': 'Нещо във формуляра не е наред. Провери го и опитай пак.',
  'privacy.page.err.NET': 'Сървърът не отговори. Думите ти са още тук: опитай пак след малко.',
};
