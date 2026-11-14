# Project 3 Write-up: When does +2 °C arrive where you live?

**Team:** The Avengineers (Ethan Cai, Mayur Nookala, Matthew Ramos)
**Live page:** https://gyjdb.github.io/dsc106-project3/

## Motivation

Whilst most people will know that we are trying to keep warming below +2 degrees globally, this is an average value. In a medium case scenario (SSP2-4.5), the world will reach +2 degrees in 2056. However, the Arctic reached +2 degrees around 2005, the tropics will reach it in 2063 and some areas of the North Atlantic never reach this by 2090. We wanted to put this global number into something people could relate to. What is the date your location will reach +2 degrees?

We also wanted to be realistic with the confidence of this information. As climate models can vary by decades for one city, we did not want to give one confident date. A previous DSC 106 project looked at the first year each location reaches +2 degrees (A World on Fire, Spring 2026). This included a chart to show what year you were born in. However this only used one model and a 2015-2034 baseline. We have used 17 models to show where there is disagreement. It also shows the warming from the pre-industrial baseline (1850-1900), and only counts a location once it reaches the target and stays there. Finally, it tells you how old you would be.

## Design Rationale

### Data & Transformations

The data we used was the monthly near surface temperature from the CMIP6 dataset (historical run and 4 SSP scenarios). We only used the 25 models that had data for all 5 experiments, and fell within the likely range of transient climate response given by the IPCC. From these we picked 17 models with no two from the same institution. This removes the hot models (Hausfather et al. 2022) which are warmer than the evidence suggests. These would have caused locations to reach the target too early. All models have been regridded to the same grid (2.5 degree resolution), and their temperature has been calculated relative to their mean temperature between 1850-1900. They have also been smoothed with a 20 year running mean, following the IPCC convention. Our median values between 2081-2100 are very similar to the best estimates given by the IPCC (e.g. +2.60 vs +2.7 degrees in SSP2-4.5). We have confidence in our pipeline.

The main challenge we faced with the transformations was deciding what to consider as reaching the target. In our initial version we simply used the first year the cell reached the target. However we noticed individual grid cells varied by several degrees across decades and so areas were reaching the target during short periods of warming. For example one cell in Antarctica reached +3 degrees in the 1860s for one model. So we changed the criteria to only consider locations that reached the target and stayed above it for at least 20 years. We also chose to consider temperature rather than rainfall as almost all (99%) of the earth has the same direction of warming across models, whereas only half of the earth has agreement on rainfall.

### Visual Encoding

The main visual is a world map showing each 2.5 degree cell as a block with the colour depending on the median year it reached the target. We chose to use the year reached rather than the warming in a particular year. This gives a single visual to show the timeline. We chose to use blocks for each cell as in our initial version we had a smooth surface which meant the map did not match the numbers shown (San Diego reached the target in 2043 according to the panel, however in the map it was still grey in 2045). We chose to use the Equal Earth projection instead of Mercator to ensure the coloured area shows the correct percentage of land and ocean as stated. This also prevents the Arctic appearing larger than it actually is. We tried a version with 16 mini maps (4 levels x 4 scenarios). However these were too small to find the location you were looking for so we went with one interactive map.

Below the map we have included a timeline to show the percentage of land and ocean that have reached the target. We chose to include this as a timeline rather than a simple slider so users can see land reaches the target before ocean (79% vs 10% by 2050) without having to interact with anything. For the selected location we have included each model's individual year reached as dots. Models disagree by decades for one city (San Diego: 2023 to 2078). Research shows discrete dots communicate uncertainty better than ranges (Kay et al. 2016). If there is disagreement about whether a location reaches the target the map will have striped colours. If we had only used the median value this would not have been shown. A similar map to ours (Mora et al. 2013) was criticised for this (Hawkins et al. 2014). Finally, the city dot plot shows the 300 largest cities in rows based on their latitude band. This shows that high latitude cities reach the target around 29 years earlier than tropical cities.

### Colour

We have divided the years reached into 5 sequential classes (dark red for the earliest to golden yellow for the latest). This makes the locations that reach the target the earliest stick out. We have used classes rather than a continuous colour scale as we can name them and separate them in the legend. As there is a large difference between models (decades) we do not want to use a fine scale as this would imply a higher accuracy than the data has. Grey is outside of the scale so it does not appear as another class. We have tested the colour palette using a simulation for red/green colour blind users and changed the last class to golden yellow as it was too similar to the grey. The scenario lines have been coloured from blue (low emissions) to dark red (very high). Each line has a label at the end.

### Interactivity

The page starts with a guessing game to help users remember the data (those who guess first will remember the data better (Kim, Reinecke and Hullman 2017)). The user's guess is highlighted in the 17 model dots. Users can also input their birth year to find out how old they would be when it reaches the target. This makes the user think about what the number actually means rather than just 2043 (you'd be 38). We have also included controls to select the warming target and scenario. The timeline can be dragged and played. There is a search bar for cities, tooltips and a sortable table. We have also included a guided tour with 6 steps to help new users find their way around. We considered only using tooltips, but chose to let users click to pin a location so it stays selected while they change the warming level and scenario. We also considered showing the answer straight away, but asking for a guess first makes the result more memorable.

There are a few patterns that we can only show using interactivity:

- Your guess compared to the 17 models.
- Cities moving into the 'not by 2090' block when the scenario is set to low emissions (177 cities out of 300 never reach the target in the low scenario).
- Land fills in much quicker than ocean.

Careful consideration was taken when writing the text. The chart titles clearly tell the user what the findings are (The 17 models span 55 years: 2023 to 2078). The headline clearly states the approximate year (+2 degrees around 2043). We have also made sure to state how many models have reached the target (9 of 17 models) rather than giving a probability as the models are related and not equal probability samples.

## Development

Ethan completed most of the page. This included creating the data pipeline (119 model runs ~3.5GB of data), checking against IPCC numbers, creating 6 exploratory charts, creating the D3 prototype, automated tests and adding the extra features (guided tour, birth year layer, city dot plot, guessing game). Claude was used throughout. The results were then checked and corrected. This is in line with the ethos of this course as we are encouraged to use AI. The checkpoint video was created as a team. Mayur and Matthew [tested the page, gave feedback on the design & text]. This write up was completed by us.

Overall this project took around [X] person hours to complete. The final page has ~2350 lines of JavaScript and 900 lines of Python. The main challenges were deciding what to consider as reaching the target (changed twice), getting the map to match the exact numbers from the panel, downloading and regridding the model data, and avoiding overlapping labels.

We have tested our work thoroughly. We have 56 automated tests to check the page works in Chrome, Safari and Firefox. We have checked the colours on the map match the data for 8580 grid cells. We have also checked the numbers on the page match the Python analysis. We also checked the regridding works correctly using fake data.

## Limitations & Future Work

Each grid cell is ~280km tall so the year shown for a city is actually the year for the cell. Everything including past years is from the model. Any locations reaching the target after ~2070 have a shorter period of staying above the target as the data stops at 2099. The page shows the absolute warming. High latitudes are leading. However, if you look at the warming relative to normal annual variations the tropics will be the first to move out of their familiar climate (Mahlstein et al. 2011). This has been noted on the page but not shown on the map. The page has not been manually tested on a phone. A future improvement would be to have a single view showing all 4 scenarios for the selected location. Currently we only have a sentence describing this.

## References

- IPCC (2021). Climate Change 2021: The Physical Science Basis, Summary for Policymakers. [doi:10.1017/9781009157896.001](https://doi.org/10.1017/9781009157896.001)
- Hausfather, Marvel, Schmidt, Nielsen-Gammon and Zelinka (2022). Climate simulations: recognize the "hot model" problem. Nature. [doi:10.1038/d41586-022-01192-2](https://doi.org/10.1038/d41586-022-01192-2)
- Mora et al. (2013). The projected timing of climate departure from recent variability. Nature. [doi:10.1038/nature12540](https://doi.org/10.1038/nature12540)
- Hawkins et al. (2014). Uncertainties in the timing of unprecedented climates. Nature. [doi:10.1038/nature13523](https://doi.org/10.1038/nature13523)
- Mahlstein, Knutti, Solomon and Portmann (2011). Early onset of significant local warming in low latitude countries. Environmental Research Letters. [doi:10.1088/1748-9326/6/3/034009](https://doi.org/10.1088/1748-9326/6/3/034009)
- Kay, Kola, Hullman and Munson (2016). When (ish) is my bus? CHI 2016. [doi:10.1145/2858036.2858558](https://doi.org/10.1145/2858036.2858558)
- Kim, Reinecke and Hullman (2017). Explaining the gap: visualizing one's predictions improves recall and comprehension of data. CHI 2017. [doi:10.1145/3025453.3025592](https://doi.org/10.1145/3025453.3025592)
