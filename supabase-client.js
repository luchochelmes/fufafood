(function (global) {
  'use strict';
  var SUPABASE_URL = 'https://hpcofktqsdiypkrgvpdw.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_G5nlSDN6vFoiaHlcXhj0Hg_222ChIDg';

  if (!global.supabase || !global.supabase.createClient) {
    if (global.console) console.error('No se pudo cargar la librería de Supabase.');
    return;
  }
  global.fufaDb = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
})(window);
