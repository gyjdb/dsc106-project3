# Project 3 Write-up: When Does +2°C Arrive Where You Live?

**Team:** The Avengineers (Ethan Cai, Mayur Nookala, Matthew Ramos)

**Live Page:** https://gyjdb.github.io/dsc106-project3/

## Motivation

Most people know that global warming is a big problem and that we are trying to keep temperatures from rising more than 2°C. However, this number is just a global average. Different parts of the world will reach 2°C of warming at different times. For example, under the medium emissions scenario (SSP2-4.5), the world is expected to reach 2°C in 2056. However, the Arctic already reached it around 2005, while tropical regions are expected to reach it in 2063. Some places in the North Atlantic might not even reach it by 2090.

We wanted to make this information more personal by letting people see when their own city or location might reach 2°C of warming, as well as wanting to show that climate predictions are not always exact. Different climate models can predict very different years for the same city. Instead of only showing one year, we used 17 climate models so users could see how much the predictions vary.

A previous DSC 106 project called A World on Fire had a similar idea, but it only used one climate model and a different temperature baseline. We wanted to improve on this by using more models, comparing temperatures to the pre-industrial period (1850–1900), and only counting a location as reaching 2°C if it stays above that temperature. We also added a feature that tells users how old they would be when their location reaches that level.

## Design Rationale

### Data & Transformations

For our project, we used monthly temperature data from the CMIP6 climate dataset. This included historical temperature data and predictions from four different emissions scenarios. We started with 25 climate models that had data for all five experiments and were within the IPCC's likely range for climate response. We then selected 17 models from different institutions so we would not have multiple models from the same institution. We also avoided models that predicted unusually high warming, since these could make locations appear to reach 2°C earlier than expected.

To make the data consistent, we put all the models on the same 2.5-degree grid. We calculated warming by comparing temperatures to the average between 1850 and 1900. We also used a 20-year running average to smooth out short-term changes in temperature. We then compared our results to the IPCC's estimates and found that they were very similar. For example, our predicted warming for 2081–2100 under SSP2-4.5 was 2.60°C, compared to the IPCC's estimate of 2.7°C.

One challenge was deciding when a location should count as reaching 2°C. At first, we used the first year a location reached that temperature. However, we noticed that some places would briefly reach the target and then fall below it again. One model even showed a location in Antarctica reaching 3°C in the 1860s. To fix this, we changed our method so that a location had to stay above the target for at least 20 years. This helped us avoid counting temporary temperature increases.

We also decided to focus on temperature instead of rainfall because climate models agree much more on temperature changes. Around 99% of the Earth is expected to warm across the models, while there is much less agreement on rainfall changes.

### Visual Encoding

Our main visualization is an interactive world map. Each block represents a 2.5-degree grid cell, and its color shows approximately when that location reaches the selected warming target. We chose to show the year a location reaches the target instead of its temperature during a specific year. This makes it easier to compare which parts of the world warm up first.

Originally, we tried making the map look smoother, but this caused problems because the colors did not always match the exact years shown in the information panel. For example, San Diego could be shown as reaching 2°C in 2043, but the map would still show it as not reaching the target in 2045. Using individual blocks fixed this problem. We also used the Equal Earth projection instead of Mercator because it represents the sizes of different regions more accurately. This is especially important for places like the Arctic, which look much larger on Mercator maps.

At first, we considered showing 16 smaller maps for all the scenarios and warming levels. However, the maps were too small, and it was difficult for users to find their location. We decided that one larger interactive map would be easier to use.

Below the map, we added a timeline showing the percentage of land and ocean that have reached the warming target. This helps users see that land warms faster than oceans. For example, by 2050, around 79% of land reaches 2°C compared to only 10% of the ocean. We also added a dot plot showing the predictions from all 17 climate models for a selected location. For San Diego, the models predict years ranging from 2023 to 2078. Showing each model as a separate dot helps users understand that the predictions have a lot of uncertainty.

When models disagree on whether a location will reach the target, we use striped colors on the map to show that disagreement.

Finally, we added a chart comparing the 300 largest cities based on their latitude. This shows that cities at higher latitudes tend to reach the warming target around 29 years earlier than cities near the tropics.

### Color

We used five colors to represent different time periods when locations reach the warming target. The colors go from dark red for locations that warm up earliest to golden yellow for locations that warm up later.

We wanted the areas warming up the fastest to stand out. We also used separate color categories instead of a smooth gradient because the climate models can disagree by decades. Using too many colors might make the predictions look more exact than they really are.

Grey represents locations that have not reached the target, so it is separate from the other colors.

We also tested our colors to see how they would look for people with red-green color blindness. We changed the last color to golden yellow because the original color looked too similar to grey. For the different emissions scenarios, we used blue for lower emissions and dark red for very high emissions. We also labeled the lines to make the chart easier to understand.

### Interactivity

We wanted users to do more than just look at a map, so we added several interactive features. The page starts with a guessing game where users try to predict when their location will reach 2°C. After they guess, they can compare their answer to the predictions from the 17 climate models. We thought this would make the information more interesting and memorable. Users can also enter their birth year to see how old they would be when their location reaches the target. For example, instead of only seeing that San Diego reaches 2°C around 2043, someone can see that they would be 38 years old. We also added controls that let users change the warming target and emissions scenario. The timeline can be dragged or played as an animation so users can watch different parts of the world reach the target over time. Other features include a city search bar, tooltips, a table of the 300 largest cities, and a six-step guided tour for first-time users.

We also made it possible to click on a location and keep it selected while changing the scenario or warming target. This is helpful because users do not have to keep searching for their city.

Some interesting patterns become easier to see through these interactions:

- Users can compare their guesses with the climate model predictions.
- Under the low emissions scenario, 177 out of the 300 largest cities do not reach the target by 2090.
- Users can watch how land reaches the warming target much faster than the ocean.

We also tried to make our chart titles explain the main findings. For example, instead of giving a general title, we show that the 17 models span 55 years for San Diego.

We avoided describing the number of models as a probability because the models are not completely independent. Instead, we show statements like "9 of 17 models" so users understand what the number actually means.

## Development

Ethan worked mostly on the beginning of the website and data processing. This included downloading and processing around 3.5GB of climate data from 119 model runs, comparing results to IPCC estimates, creating six exploratory charts, building the D3 map, and adding interactive features. He also worked on the guessing game, guided tour, birth year feature, and city comparison chart. 

Matthew tested the website and made several changes to make it easier to use. He added a line to the location panel showing the range of years projected by the climate models, along with a note that projections after 2070 are less certain. For example, he added rings that now pulse around the selected city, making it easier to spot on the map whether users select it from the search bar, buttons, city table, or city comparison chart. He also added a "Reset view" button above the map returns users to the starting view and brings back the guessing game, a slider track to the timeline, a better search dropdown menu, and a revised "tour".

Mayur also tested the website and gave feedback on the design, wording, and overall user experience. All three of us worked together on both the checkpoint video and the final write-up. 

We used AI tools to assist with coding and other development tasks, then reviewed the output and corrected it where needed. Overall, the project took about 30 person-hours to complete. The final website contains around 2,580 lines of JavaScript and 900 lines of Python.

Some of the biggest challenges were figuring out when a location should count as reaching the target, making sure the map colors matched the data, processing the climate models, and fixing labels that overlapped. We also spent time testing our website. We created 56 automated tests to check that the page works in Chrome, Safari, and Firefox. We checked that the map colors matched the data for all 8,580 grid cells and that the numbers shown on the website matched our Python results. We also tested the regridding process using fake data to make sure it worked correctly.

## Limitations & Future Work

Our project has a few limitations. First, each grid cell is around 280 km tall, so the year shown for a city is actually based on the larger grid cell it belongs to. This means the results are not perfectly accurate for every individual city. Another limitation is that all the temperature values, including past years, come from climate models rather than direct observations. Also, because our dataset ends in 2099, locations that reach the warming target after around 2070 cannot be checked for the full 20 years above the target.

Our map also focuses on absolute warming. It shows that high-latitude regions are warming faster, but it does not show how unusual the warming is compared to a location's normal temperature changes. For example, tropical regions might experience more unusual conditions earlier because their temperatures usually do not vary as much. We explain this on the website, but it is not directly shown on the map. We also have not manually tested the website on a phone, so the mobile experience could still be improved.

In the future, we would like to add a feature that shows all four emissions scenarios for one selected location at the same time. Right now, the website only describes this comparison in a sentence. Having a chart would make it easier for users to compare how different emissions levels could affect their city.

Overall, our goal was to help people understand how global warming could affect their own location and show that climate predictions can vary depending on the model and emissions scenario.
