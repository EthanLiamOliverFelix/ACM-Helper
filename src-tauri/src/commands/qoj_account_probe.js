(function () {
  try {
    return {
      ready: Boolean(document.body)
        && /^(?:www\.)?qoj\.ac$/i.test(location.hostname)
        && !/just a moment|checking your browser/i.test(document.title || '')
        && !document.querySelector('#challenge-running, #challenge-form'),
      // QOJ also renders its account dropdown above the content, outside .navbar.
      navbar: Array.from(document.querySelectorAll(
        'nav, .navbar, header, #header, '
        + '.container[role="main"] > div > ul.nav-pills.float-right[role="tablist"]'
      ))
        .map(function (node) { return node.outerHTML; }).join('\n'),
      loginForm: Boolean(document.querySelector('form input[type="password"]'))
    };
  } catch (error) {
    return { ready: false };
  }
})();
