-- Seed climate-change graph data
-- Factual seed set grounded in IPCC AR6 concepts.

begin;

insert into public.nodes (id, title, summary, type, status, confidence, votes_count, created_by) values
('f1001','Climate change','Long-term shifts in temperature and weather patterns, especially since the industrial era.','fact','new',4.8,0,null),
('f1002','Greenhouse effect','Warming caused when greenhouse gases trap outgoing infrared radiation.','fact','new',4.7,0,null),
('f1003','Carbon dioxide','A long-lived greenhouse gas released by fossil-fuel burning, deforestation, and industry.','fact','new',4.8,0,null),
('f1004','Methane','A potent greenhouse gas with a shorter atmospheric lifetime than carbon dioxide.','fact','new',4.6,0,null),
('f1005','Fossil fuel combustion','Burning coal, oil, and gas is the largest source of human greenhouse-gas emissions.','fact','new',4.8,0,null),
('f1006','Deforestation','Forest loss reduces carbon storage and can release stored carbon to the atmosphere.','fact','new',4.5,0,null),
('f1007','Global warming','The rise in Earth’s average surface temperature driven mainly by human greenhouse-gas emissions.','fact','new',4.8,0,null),
('f1008','Ocean heat content','The ocean has absorbed most of the excess heat from greenhouse warming.','fact','new',4.7,0,null),
('f1009','Sea-level rise','Global mean sea level is rising as oceans warm and land ice melts.','fact','new',4.7,0,null),
('f1010','Heat extremes','Hot extremes have become more frequent and intense in many regions.','fact','new',4.7,0,null),
('f1011','Heavy precipitation','A warmer atmosphere can hold more moisture, increasing the risk of intense rainfall.','fact','new',4.6,0,null),
('f1012','Drought risk','Rising temperatures can worsen drying and raise drought risk in vulnerable regions.','fact','new',4.5,0,null),
('f1013','Ocean acidification','Absorption of carbon dioxide by seawater lowers pH and affects marine ecosystems.','fact','new',4.6,0,null),
('f1014','Arctic sea ice decline','Arctic sea ice has decreased substantially in the satellite era.','fact','new',4.6,0,null),
('f1015','Climate adaptation','Adjusting systems and communities to reduce harm from climate impacts.','fact','new',4.5,0,null),
('f1016','Climate mitigation','Actions that reduce greenhouse-gas emissions or increase sinks.','fact','new',4.7,0,null),
('f1017','Renewable energy','Energy from sources like solar, wind, hydro, and geothermal with low operational emissions.','fact','new',4.5,0,null),
('f1018','Energy efficiency','Using less energy for the same service through better technology and design.','fact','new',4.5,0,null),
('f1019','Carbon capture and storage','A set of technologies that capture carbon dioxide and store it underground.','fact','new',4.3,0,null),
('f1020','Net zero emissions','Balancing greenhouse-gas emissions with removals so remaining emissions are offset.','fact','new',4.6,0,null);

insert into public.links (from_id, to_id, kind, created_by) values
('f1001','f1007','support',null),
('f1002','f1001','support',null),
('f1003','f1002','support',null),
('f1004','f1002','support',null),
('f1005','f1003','support',null),
('f1005','f1004','support',null),
('f1006','f1003','support',null),
('f1007','f1008','support',null),
('f1007','f1009','support',null),
('f1007','f1010','support',null),
('f1007','f1011','support',null),
('f1007','f1012','support',null),
('f1003','f1013','support',null),
('f1007','f1014','support',null),
('f1015','f1009','support',null),
('f1015','f1010','support',null),
('f1016','f1015','support',null),
('f1016','f1017','support',null),
('f1016','f1018','support',null),
('f1016','f1019','support',null),
('f1016','f1020','support',null),
('f1017','f1016','support',null),
('f1018','f1016','support',null),
('f1019','f1016','support',null),
('f1020','f1016','support',null),
('f1010','f1015','conflict',null),
('f1009','f1015','support',null),
('f1011','f1015','support',null),
('f1012','f1015','support',null),
('f1008','f1009','support',null),
('f1014','f1009','support',null);

commit;
