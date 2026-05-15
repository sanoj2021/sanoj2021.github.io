window.SDB = {
  nodes: [
    {
      id:'f1', title:'Plants convert light energy into chemical energy via photosynthesis.',
      type:'fact', status:'stable', confidence:4.6, votes:184,
      summary:'Core biology statement; parent node for several derived claims.',
      sources:['s1','s2'], links:[{to:'f2',kind:'support'},{to:'f3',kind:'depend'}]
    },
    {
      id:'f2', title:'Chlorophyll absorbs light most strongly in blue and red wavelengths.',
      type:'fact', status:'stable', confidence:4.2, votes:91,
      summary:'Supporting claim connecting photosynthesis to pigment behaviour.',
      sources:['s2'], links:[{to:'f1',kind:'support'},{to:'f4',kind:'conflict'}]
    },
    {
      id:'f3', title:'Glucose production in plants depends on carbon fixation pathways.',
      type:'fact', status:'open', confidence:4.0, votes:72,
      summary:'Dependent node showing how process-oriented facts chain forward.',
      sources:['s1'], links:[{to:'f1',kind:'depend'},{to:'f5',kind:'support'}]
    },
    {
      id:'f4', title:'Green light is the primary wavelength used by chlorophyll for energy capture.',
      type:'claim', status:'challenged', confidence:1.8, votes:55,
      summary:'Disputed claim — conflicts with the stronger wavelength absorption fact.',
      sources:['s3'], links:[{to:'f2',kind:'conflict'}]
    },
    {
      id:'f5', title:'C3 plants use Rubisco to initially fix carbon dioxide.',
      type:'fact', status:'stable', confidence:4.4, votes:88,
      summary:'Lower-level node branching from the carbon fixation statement.',
      sources:['s1'], links:[{to:'f3',kind:'support'}]
    },
    {
      id:'f6', title:'Is there a secondary pigment pathway active in low-light conditions?',
      type:'question', status:'question', confidence:3.1, votes:23,
      summary:'Open question node — evidence is still incomplete.',
      sources:['s4'], links:[{to:'f1',kind:'depend'}]
    }
  ],
  sources: {
    s1:{id:'s1',title:'Campbell Biology — photosynthesis chapter',kind:'textbook',quality:'high',note:'Broadly accepted educational source.'},
    s2:{id:'s2',title:'Peer-reviewed pigment absorption review',kind:'paper',quality:'high',note:'Directly relevant to wavelength absorption claims.'},
    s3:{id:'s3',title:'Short science blog post on leaf color',kind:'web',quality:'low',note:'Potentially misleading; weakly connected to the claim.'},
    s4:{id:'s4',title:'Open discussion thread on unresolved plant metabolism',kind:'discussion',quality:'mixed',note:'Useful context, not a strong final source.'}
  }
};
