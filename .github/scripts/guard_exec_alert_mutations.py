from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old="""  function mutationOnlyTouchesExecAlertsCard(mutation){
    const nodes=[...mutation.addedNodes,...mutation.removedNodes];
    return nodes.length>0&&nodes.every(node=>{
      if(node.nodeType!==1)return false;
      return node.id==='execAlertsCard'||Boolean(node.closest?.('#execAlertsCard'));
    });
  }
"""
new="""  function mutationOnlyTouchesExecAlertsCard(mutation){
    const target=mutation.target;
    const targetElement=target?.nodeType===1?target:target?.parentElement;
    if(targetElement&&(targetElement.id==='execAlertsCard'||targetElement.closest?.('#execAlertsCard')))return true;
    const nodes=[...mutation.addedNodes,...mutation.removedNodes];
    return nodes.length>0&&nodes.every(node=>{
      if(node.nodeType!==1)return false;
      return node.id==='execAlertsCard'||Boolean(node.closest?.('#execAlertsCard'));
    });
  }
"""
if old not in s:
    raise SystemExit('target mutation helper not found')
p.write_text(s.replace(old,new,1),encoding='utf-8',newline='')
