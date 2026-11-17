(function(){
  'use strict';
  var API_PRIMARY='https://api.spot-hinta.fi/TodayAndDayForward?region=FI&priceResolution=15';
  var API_FALLBACK='https://public-data.volton.energy/v1/day-ahead-spot-fi/latest.json';
  var CACHE='powerprice-fi-cache-v7';
  var state={rows:[],selected:'today',lastUpdate:null,lastChartMinuteKey:null,inspectLocked:false,lastTomorrowCheck:0};
  var $=function(id){return document.getElementById(id)};

  function pad(n){return n<10?'0'+n:String(n)}
  function localDateKey(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
  function tomorrowKey(){var d=new Date();d.setDate(d.getDate()+1);return localDateKey(d)}
  function fmtTime(d){return pad(d.getHours())+':'+pad(d.getMinutes())}
  function fmtDate(d){var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return days[d.getDay()]+' '+d.getDate()+'.'+(d.getMonth()+1)+'.'}
  function fmtClock(d){return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())}
  function selectedDate(){var d=new Date();if(state.selected==='tomorrow')d.setDate(d.getDate()+1);return d}
  function updateClock(){var now=new Date();$('dayTitle').textContent=fmtDate(now)+'   '+fmtClock(now);var key=localDateKey(now)+'-'+now.getHours()+'-'+now.getMinutes();if(state.lastChartMinuteKey!==key){state.lastChartMinuteKey=key;if(state.rows.length)render()}}
  function priceText(v){if(v===null||!isFinite(v))return '—';return (Math.round(v*100)/100).toFixed(2)}
  function endOfSlot(d){return new Date(d.getTime()+15*60000)}

  function normalizePrimary(json){
    if(!Array.isArray(json))return [];
    return json.filter(function(r){return r && r.DateTime && typeof r.PriceWithTax==='number'}).map(function(r){
      return {start:new Date(r.DateTime),price:r.PriceWithTax*100,raw:r.PriceNoTax,source:'spot-hinta.fi'};
    }).sort(function(a,b){return a.start-b.start});
  }

  function normalizeFallback(json){
    var rows=(json&&json.rows)||[];
    return rows.filter(function(r){return typeof r.price_eur_mwh==='number' && r.mtu_start}).map(function(r){
      return {start:new Date(r.mtu_start),price:r.price_eur_mwh/10*1.255,raw:r.price_eur_mwh,source:'Volton'};
    }).sort(function(a,b){return a.start-b.start});
  }

  function saveCache(rows){
    try{
      localStorage.setItem(CACHE,JSON.stringify({saved:Date.now(),rows:rows.map(function(r){return {start:r.start.toISOString(),price:r.price,raw:r.raw,source:r.source}})}));
    }catch(e){}
  }
  function loadCache(){
    try{
      var x=JSON.parse(localStorage.getItem(CACHE));
      if(!x||!x.rows)return [];
      return x.rows.map(function(r){return {start:new Date(r.start),price:r.price,raw:r.raw,source:r.source||'cache'}});
    }catch(e){return []}
  }

  function requestJson(url){
    return fetch(url,{cache:'no-store',mode:'cors'}).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    });
  }

  function acceptRows(rows,source){
    if(!rows || rows.length<80)throw new Error('Incomplete price data');
    state.rows=rows;
    state.lastUpdate=new Date();
    saveCache(rows);
    render();
    setStatus('Updated '+fmtTime(state.lastUpdate)+' · '+source,false);
  }

  function fetchData(options){
    options=options||{};
    if(!options.quiet)setStatus('Updating…',false);
    requestJson(API_PRIMARY).then(function(json){
      var rows=normalizePrimary(json);
      acceptRows(rows,'spot-hinta.fi');
    }).catch(function(primaryErr){
      requestJson(API_FALLBACK).then(function(json){
        var rows=normalizeFallback(json);
        acceptRows(rows,'fallback');
      }).catch(function(fallbackErr){
        var cached=loadCache();
        if(cached.length){
          state.rows=cached;render();setStatus('Offline · cached prices',true);
        }else{
          setStatus('Could not load prices · '+(primaryErr&&primaryErr.message?primaryErr.message:'network error'),true);
          showError();
        }
      });
    });
  }

  function maybeRefreshTomorrow(){
    var now=new Date();
    var minutes=now.getHours()*60+now.getMinutes();
    var tomorrowRows=dayRows(tomorrowKey());
    if(tomorrowRows.length)return;
    if(minutes<14*60+20)return;
    if(Date.now()-state.lastTomorrowCheck<5*60*1000)return;
    state.lastTomorrowCheck=Date.now();
    fetchData({quiet:true});
  }

  function setStatus(text,error){$('status').textContent=text;$('status').className='status'+(error?' error':'')}
  function dayRows(key){return state.rows.filter(function(r){return localDateKey(r.start)===key})}

  function currentSlot(rows,now){
    for(var i=0;i<rows.length;i++) if(now>=rows[i].start && now<endOfSlot(rows[i].start)) return rows[i];
    return null;
  }

  function futureRows(rows,now,includeCurrent){
    return rows.filter(function(r){return includeCurrent ? endOfSlot(r.start)>now : r.start>=now});
  }

  function minimum(rows){
    if(!rows.length)return null;var best=rows[0];for(var i=1;i<rows.length;i++)if(rows[i].price<best.price)best=rows[i];return best;
  }

  function bestHour(rows,now,isToday){
    if(rows.length<4)return null;
    var first=0;
    if(isToday){while(first<rows.length && rows[first].start<now)first++;}
    var best=null;
    for(var i=first;i<=rows.length-4;i++){
      var ok=true,sum=0;
      for(var j=0;j<4;j++){
        if(j>0 && rows[i+j].start-rows[i+j-1].start!==15*60000){ok=false;break}
        sum+=rows[i+j].price;
      }
      if(ok){var avg=sum/4;if(!best||avg<best.avg)best={start:rows[i].start,end:endOfSlot(rows[i+3].start),avg:avg}}
    }
    return best;
  }

  function hourExtreme(rows,wantMax){
    if(rows.length<4)return null;
    var best=null;
    for(var i=0;i<=rows.length-4;i++){
      var ok=true,sum=0;
      for(var j=0;j<4;j++){
        if(j>0 && rows[i+j].start-rows[i+j-1].start!==15*60000){ok=false;break}
        sum+=rows[i+j].price;
      }
      if(ok){
        var avg=sum/4;
        if(!best || (wantMax?avg>best.avg:avg<best.avg)) best={start:rows[i].start,end:endOfSlot(rows[i+3].start),avg:avg};
      }
    }
    return best;
  }

  function render(){
    var now=new Date();var today=localDateKey(now),tomorrow=tomorrowKey();
    var todayRows=dayRows(today),tomorrowRows=dayRows(tomorrow);
    $('tomorrowBtn').disabled=!tomorrowRows.length;
    $('tomorrowBtn').title=tomorrowRows.length?'View tomorrow':'Tomorrow prices appear after the day-ahead auction (usually by ~15:00)';
    if(state.selected==='tomorrow'&&!tomorrowRows.length)state.selected='today';
    var key=state.selected==='today'?today:tomorrow;var rows=state.selected==='today'?todayRows:tomorrowRows;
    $('todayBtn').className='tab'+(state.selected==='today'?' active':'');
    $('tomorrowBtn').className='tab'+(state.selected==='tomorrow'?' active':'');
    var date=state.selected==='today'?now:(function(){var d=new Date();d.setDate(d.getDate()+1);return d})();
    updateClock();
    $('chartTitle').textContent=(state.selected==='today'?'Today’s':'Tomorrow’s')+' price';

    if(!rows.length){showNoDay(state.selected);return}

    var slot=state.selected==='today'?currentSlot(rows,now):rows[0];
    if(state.selected==='today'&&slot){
      $('currentPrice').textContent=priceText(slot.price);
      $('currentInterval').innerHTML='<strong>'+fmtTime(slot.start)+'–'+fmtTime(endOfSlot(slot.start))+'</strong>Current 15-minute price';
    } else if(state.selected==='tomorrow'){
      $('currentPrice').textContent=priceText(minimum(rows).price);
      $('currentInterval').innerHTML='<strong>'+fmtTime(minimum(rows).start)+'–'+fmtTime(endOfSlot(minimum(rows).start))+'</strong>Tomorrow’s lowest price';
    } else {
      $('currentPrice').textContent='—';$('currentInterval').innerHTML='<strong>Outside price data</strong>Refresh shortly';
    }

    var remaining=state.selected==='today'?futureRows(rows,now,false):rows.slice();
    var low=minimum(remaining);
    $('lowLabel').textContent=state.selected==='today'?'Next lowest':'Lowest price';
    $('lowValue').textContent=low?priceText(low.price)+' c/kWh':'No future slots';
    $('lowTime').textContent=low?fmtTime(low.start)+'–'+fmtTime(endOfSlot(low.start)):'—';

    var best=bestHour(rows,now,state.selected==='today');
    $('hourLabel').textContent=state.selected==='today'?'Best remaining 1 hour':'Best 1 hour';
    $('hourValue').textContent=best?priceText(best.avg)+' c/kWh avg':'No full hour left';
    $('hourTime').textContent=best?fmtTime(best.start)+'–'+fmtTime(best.end):'—';
    drawChart(rows,now,state.selected==='today');
  }

  function showNoDay(which){
    $('currentPrice').textContent='—';
    $('currentInterval').innerHTML='<strong>'+(which==='tomorrow'?'Not available yet':'No price data')+'</strong>'+(which==='tomorrow'?'Usually published by ~15:00':'Check connection');
    $('lowValue').textContent='—';$('lowTime').textContent='—';$('hourValue').textContent='—';$('hourTime').textContent='—';$('chart').innerHTML='';
  }
  function showError(){showNoDay('today')}

  function priceColor(v){
    if(v<5)return '#63b3ff';       // low: cool blue
    if(v<10)return '#8b7cff';      // normal: violet
    if(v<15)return '#c56cf0';      // elevated: purple/pink
    if(v<25)return '#ff7aa2';      // high: pink
    return '#ff5f6d';              // very high: red
  }

  function drawChart(rows,now,isToday){
    var svg=$('chart');
    var W=Math.max(svg.clientWidth||900,600),H=Math.max(svg.clientHeight||360,300);
    var m={l:48,r:18,t:20,b:34};
    var cw=W-m.l-m.r,ch=H-m.t-m.b;
    var vals=rows.map(function(r){return r.price});
    var dataMax=Math.max.apply(Math,vals);

    // Fixed 0–25 c/kWh scale. Expand upward only when the day exceeds 25.
    var minY=0;
    var maxY=dataMax<=25?25:Math.ceil(dataMax/5)*5;
    if(maxY<=minY)maxY=25;

    function minuteOfDay(d){return d.getHours()*60+d.getMinutes()}
    function xMinute(minute){return m.l+(minute/1440)*cw}
    function xRow(r){return xMinute(minuteOfDay(r.start))}
    function y(v){
      var clamped=Math.max(minY,Math.min(maxY,v));
      return m.t+(maxY-clamped)/(maxY-minY)*ch;
    }
    function stepLinePath(rs){
      if(!rs.length)return '';
      var p='M '+xRow(rs[0])+' '+y(rs[0].price);
      for(var i=0;i<rs.length;i++){
        var xEnd=xMinute(Math.min(1440,minuteOfDay(rs[i].start)+15));
        p+=' H '+xEnd;
        if(i<rs.length-1)p+=' V '+y(rs[i+1].price);
      }
      return p;
    }
    function areaPath(rs){
      if(!rs.length)return '';
      var base=y(0), p='M '+xRow(rs[0])+' '+base+' L '+xRow(rs[0])+' '+y(rs[0].price);
      for(var i=0;i<rs.length;i++){
        var xEnd=xMinute(Math.min(1440,minuteOfDay(rs[i].start)+15));
        p+=' H '+xEnd;
        if(i<rs.length-1)p+=' V '+y(rs[i+1].price);
      }
      p+=' L '+xMinute(1440)+' '+base+' Z';
      return p;
    }

    var out=[];
    out.push('<defs>');
    out.push('<linearGradient id="priceFill" x1="0" y1="1" x2="0" y2="0">');
    out.push('<stop offset="0%" stop-color="#5f6fa8"/><stop offset="42%" stop-color="#7658aa"/><stop offset="72%" stop-color="#b34d9f"/><stop offset="100%" stop-color="#ef4b96"/>');
    out.push('</linearGradient>');
    out.push('<linearGradient id="priceStroke" x1="0" y1="1" x2="0" y2="0">');
    out.push('<stop offset="0%" stop-color="#23177c"/><stop offset="55%" stop-color="#5b238a"/><stop offset="100%" stop-color="#f13b91"/>');
    out.push('</linearGradient>');
    out.push('</defs>');

    for(var vv=0;vv<=maxY;vv+=5){
      var yy=y(vv);
      out.push('<line class="grid" x1="'+m.l+'" y1="'+yy+'" x2="'+(W-m.r)+'" y2="'+yy+'"/>');
      out.push('<text class="axis" x="'+(m.l-8)+'" y="'+(yy+4)+'" text-anchor="end">'+vv+'</text>');
    }

    for(var hour=0;hour<=24;hour+=3){
      var xx=xMinute(hour*60);
      out.push('<line class="grid" x1="'+xx+'" y1="'+m.t+'" x2="'+xx+'" y2="'+(H-m.b)+'" opacity=".30"/>');
      out.push('<text class="axis" x="'+xx+'" y="'+(H-8)+'" text-anchor="middle">'+pad(hour)+':00</text>');
    }

    // Filled stepped price shape, Helen-inspired but simplified for an always-on dashboard.
    out.push('<path class="area" d="'+areaPath(rows)+'" fill="url(#priceFill)"/>');
    out.push('<path class="step-line" d="'+stepLinePath(rows)+'" stroke="url(#priceStroke)"/>');

    var nowIdx=-1, nowX=null;
    if(isToday){
      for(var i=0;i<rows.length;i++){
        if(now>=rows[i].start&&now<endOfSlot(rows[i].start)){nowIdx=i;break}
      }
      var nowMinute=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
      nowX=xMinute(Math.max(0,Math.min(1440,nowMinute)));
    }

    // Fade past prices while leaving the hour-window markers above them.
    if(isToday&&nowX>m.l) out.push('<rect class="past-fade" x="'+m.l+'" y="'+m.t+'" width="'+(nowX-m.l)+'" height="'+ch+'"/>');

    // Show the cheapest and most expensive one-hour windows of the displayed day.
    var bestDay=hourExtreme(rows,false), worstDay=hourExtreme(rows,true);
    function drawHourBand(item,kind,label){
      if(!item)return;
      var x1=xMinute(minuteOfDay(item.start));
      var duration=(item.end-item.start)/60000;
      var x2=xMinute(Math.min(1440,minuteOfDay(item.start)+duration));
      var cls=kind==='best'?'hour-best':'hour-worst';
      var tcls=kind==='best'?'band-label band-label-best':'band-label band-label-worst';
      var opacity=isToday&&x2<=nowX?'.6':'1';
      out.push('<rect class="'+cls+'" x="'+x1+'" y="'+m.t+'" width="'+Math.max(3,x2-x1)+'" height="'+ch+'" opacity="'+opacity+'"/>');
      var tx=(x1+x2)/2;
      out.push('<text class="'+tcls+'" x="'+tx+'" y="'+(m.t+13)+'" text-anchor="middle" opacity="'+opacity+'">'+label+'</text>');
    }
    drawHourBand(bestDay,'best','BEST 1H');
    drawHourBand(worstDay,'worst','WORST 1H');

    if(isToday&&nowIdx>=0){
      var badgeWidth=92,badgeX=nowX>W-m.r-badgeWidth-12?nowX-badgeWidth-8:nowX+8,badgeY=m.t+6;
      out.push('<line class="now-line-halo" x1="'+nowX+'" y1="'+m.t+'" x2="'+nowX+'" y2="'+(H-m.b)+'" stroke="#fff" stroke-width="5"/>');
      out.push('<line class="now-line" x1="'+nowX+'" y1="'+m.t+'" x2="'+nowX+'" y2="'+(H-m.b)+'" stroke="#1769e0" stroke-width="2.5"/>');
      out.push('<polygon class="now-marker" points="'+(nowX-5)+','+m.t+' '+(nowX+5)+','+m.t+' '+nowX+','+(m.t+7)+'" fill="#1769e0"/>');
      out.push('<rect class="now-label-bg" x="'+badgeX+'" y="'+badgeY+'" width="'+badgeWidth+'" height="20" rx="5" fill="#1769e0"/>');
      out.push('<text class="now-label" id="nowLabel" x="'+(badgeX+8)+'" y="'+(badgeY+14)+'" fill="#fff" font-size="10" font-weight="800">NOW '+fmtTime(now)+'</text>');
      out.push('<circle class="now-dot" cx="'+nowX+'" cy="'+y(rows[nowIdx].price)+'" r="5" fill="#1769e0" stroke="#fff" stroke-width="2.5"/>');

      var rem=futureRows(rows,now,false),lo=minimum(rem);
      if(lo)out.push('<circle class="low-dot" cx="'+xRow(lo)+'" cy="'+y(lo.price)+'" r="5"/>');
    } else if(!isToday){
      var lo2=minimum(rows);
      if(lo2)out.push('<circle class="low-dot" cx="'+xRow(lo2)+'" cy="'+y(lo2.price)+'" r="5"/>');
    }

    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    svg.innerHTML=out.join('');
    setupInspect(svg,rows,W,H,m,cw,ch,xMinute,y);
  }

  function setupInspect(svg,rows,W,H,m,cw,ch,xMinute,y){
    var NS='http://www.w3.org/2000/svg';
    var group=document.createElementNS(NS,'g');
    group.setAttribute('id','inspectOverlay');
    group.style.display='none';
    group.style.pointerEvents='none';

    var line=document.createElementNS(NS,'line');line.setAttribute('class','inspect-line');group.appendChild(line);
    var dot=document.createElementNS(NS,'circle');dot.setAttribute('class','inspect-dot');dot.setAttribute('r','5');group.appendChild(dot);
    var box=document.createElementNS(NS,'rect');box.setAttribute('class','tooltip-box');box.setAttribute('rx','8');box.setAttribute('width','154');box.setAttribute('height','52');group.appendChild(box);
    var tt=document.createElementNS(NS,'text');tt.setAttribute('class','tooltip-time');group.appendChild(tt);
    var tp=document.createElementNS(NS,'text');tp.setAttribute('class','tooltip-price');group.appendChild(tp);
    svg.appendChild(group);

    function rowForMinute(minute){
      var idx=Math.max(0,Math.min(95,Math.floor(minute/15)));
      var target=idx*15;
      for(var i=0;i<rows.length;i++){if((rows[i].start.getHours()*60+rows[i].start.getMinutes())===target)return rows[i]}
      return null;
    }
    function svgPoint(clientX){
      var rect=svg.getBoundingClientRect();
      if(!rect.width)return null;
      var sx=(clientX-rect.left)*(W/rect.width);
      var minute=(sx-m.l)/cw*1440;
      return {x:sx,minute:Math.max(0,Math.min(1439.999,minute))};
    }
    function showAt(clientX,lock){
      var p=svgPoint(clientX);if(!p)return;
      var row=rowForMinute(p.minute);if(!row)return;
      var minute=row.start.getHours()*60+row.start.getMinutes();
      var x=xMinute(minute+7.5), yy=y(row.price);
      var bx=x+12;if(bx+154>W-m.r)bx=x-166;if(bx<m.l)bx=m.l+4;
      var by=yy-62;if(by<m.t+4)by=yy+12;if(by+52>H-m.b)by=H-m.b-56;
      line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('y1',m.t);line.setAttribute('y2',H-m.b);
      dot.setAttribute('cx',x);dot.setAttribute('cy',yy);
      box.setAttribute('x',bx);box.setAttribute('y',by);
      tt.setAttribute('x',bx+12);tt.setAttribute('y',by+19);tt.textContent=fmtTime(row.start)+'–'+fmtTime(endOfSlot(row.start));
      tp.setAttribute('x',bx+12);tp.setAttribute('y',by+41);tp.textContent=priceText(row.price)+' c/kWh';
      group.style.display='';
      if(lock)state.inspectLocked=true;
    }
    svg.addEventListener('pointermove',function(e){if(e.pointerType==='mouse'&&!state.inspectLocked)showAt(e.clientX,false)});
    svg.addEventListener('pointerleave',function(){if(!state.inspectLocked)group.style.display='none'});
    svg.addEventListener('pointerdown',function(e){state.inspectLocked=false;showAt(e.clientX,true);e.preventDefault()});
    svg.addEventListener('dblclick',function(){state.inspectLocked=false;group.style.display='none'});
  }

  $('todayBtn').onclick=function(){state.selected='today';state.inspectLocked=false;render()};
  $('tomorrowBtn').onclick=function(){if(!$('tomorrowBtn').disabled){state.selected='tomorrow';state.inspectLocked=false;render()}};
  window.addEventListener('resize',function(){render()});
  updateClock();
  setInterval(updateClock,1000);
  setInterval(function(){fetchData({quiet:true})},15*60000);
  setInterval(maybeRefreshTomorrow,60*1000);
  fetchData();
})();
