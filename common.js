(function(){
  /* 첫 화면에서 로고를 누르면 맨 위로 */
  var brand=document.getElementById('brandHome');
  if(brand && location.pathname==='/'){
    brand.addEventListener('click',function(e){
      e.preventDefault();
      if(location.hash) history.replaceState(null,'',location.pathname+location.search);
      window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    });
  }
  /* 스크롤 진행 바 */
  var bar=document.getElementById('scrollProgress'), ticking=false;
  function update(){
    var max=document.documentElement.scrollHeight-innerHeight;
    bar.style.transform='scaleX('+(max>0?Math.min(scrollY/max,1):0)+')';
    ticking=false;
  }
  if(bar){
    addEventListener('scroll',function(){ if(!ticking){ticking=true;requestAnimationFrame(update);} },{passive:true});
    addEventListener('resize',update); update();
  }
})();
