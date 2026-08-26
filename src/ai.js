const AI = (function(){
  return { LEVELS:[{id:1,name:'Escudero'}], pick:function(s){ var ms=Engine.legalMoves(s); if(!ms.length) return null;
    var caps=ms.filter(function(m){return m.cap;}); var pool=(caps.length&&Math.random()<0.7)?caps:ms; return pool[(Math.random()*pool.length)|0]; } };
})();
