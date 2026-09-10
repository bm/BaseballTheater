import { Button, ButtonGroup, Menu, MenuItem, Tab, Tabs } from '@material-ui/core';
import { LiveData } from 'baseball-theater-engine';
import moment from 'moment';
import { useState } from 'react';
import React from 'react';
import Helmet from 'react-helmet';
import { IoIosMenu } from 'react-icons/all';
import { useParams } from 'react-router-dom';

import { usePrevious } from '../../Global/Hooks/usePrevious';
import { useDataStore } from '../../Global/Intercom/DataStore';
import { RespondDataStore, RespondDataStorePayload, RespondSizes } from '../../Global/Respond/RespondDataStore';
import { IGameTabDetailParams, SiteRoutes } from '../../Global/Routes/Routes';
import { ContainerProgress } from '../../UI/ContainerProgress';
import { HalfInnings, Inning } from './Components/Innings';
import { MiniBoxScore } from './Components/MiniBoxScore';
import { ScoringPlays } from './Components/ScoringPlays';
import styles from './Plays.module.scss';
import { PlayUtils } from './Utils/PlayUtils';


interface IPlaysProps {
	liveData: LiveData;
}

interface DefaultProps {
}

type Props = IPlaysProps & DefaultProps;
type State = IPlaysState;

interface IPlaysState {
	selectedInning: number;
	respond: RespondDataStorePayload;
	halfInnings: HalfInnings[];
	halfInningsKeysSorted: string[][];
	inningMenuOpen: boolean;
	mode: "scoring" | "all";
}

export const Plays: React.FC<Props> = React.memo((props) => {
	const params = useParams<IGameTabDetailParams>();
	const buttonRef = React.useRef<HTMLButtonElement>(null);
	const prevProps = usePrevious(props);

	const halfInnings = React.useMemo(() => {
		if (!props.liveData?.liveData) {
			return [] as HalfInnings[];
		}

		return PlayUtils.getHalfInningsByInning(props.liveData.liveData);
	}, [props.liveData]);

	const halfInningsKeysSorted = React.useMemo(() => halfInnings.map(hi => Object.keys(hi).sort((a, b) => {
		const aPlay = hi[a];
		const bPlay = hi[b];
		const aHalfVal = aPlay.halfInning.length / 10;
		const bHalfVal = bPlay.halfInning.length / 10;
		const aInning = aPlay.inningNumber + aHalfVal;
		const bInning = bPlay.inningNumber + bHalfVal;
		return aInning - bInning;
	})), [halfInnings]);

	const inningsWithPlays = (props.liveData?.liveData.linescore.innings ?? [])
		.map((inning, i) => ({
			inning,
			num: inning?.num ?? i + 1,
			hasPlays: Object.keys(halfInnings[i] ?? {}).length > 0
		}))
		.filter(entry => entry.hasPlays && !!entry.inning);

	const latestPlayableInning = inningsWithPlays[inningsWithPlays.length - 1]?.num ?? -1;

	const [pinnedInning, setPinnedInning] = useState<number | null>(null);
	const respond = useDataStore(RespondDataStore);
	const [inningMenuOpen, setInningMenuOpen] = useState(false);
	const [mode, setMode] = useState<"scoring" | "all">(params.tabDetail === "all" ? "all" : "scoring");

	const pinnedInningHasPlays = pinnedInning != null && inningsWithPlays.some(entry => entry.num === pinnedInning);
	const activeInning = pinnedInningHasPlays
		? pinnedInning
		: latestPlayableInning;

	const onInningSelect = (inning: number) => setPinnedInning(inning === latestPlayableInning ? null : inning);

	const onMenuClose = () => setInningMenuOpen(false);

	const onMenuSelect = (index: number) => {
		window.scrollTo(0, 0);
		onInningSelect(index);
		onMenuClose();
	};

	const onPlayModeClick = (mode: "scoring" | "all") => {
		setMode(mode);

		window.history.replaceState(null, null, SiteRoutes.GameTabDetail.resolve({
			gameDate: "_",
			gameId: props.liveData.gamePk.toString(),
			tab: "Plays",
			tabDetail: mode
		}));
	}

	if (!props.liveData) {
		return <ContainerProgress />;
	}

	const liveData = props.liveData.liveData;

	const isMedium = respond.sizes.indexOf(RespondSizes.medium) > -1;

	const orientation = isMedium
		? "horizontal"
		: "vertical";

	const teams = props.liveData.gameData.teams;
	const date = moment(props.liveData.gameData.datetime.dateTime).format("MMMM D, YYYY");

	const halfInningsChosen = halfInnings?.[activeInning - 1];
	const keys = halfInningsKeysSorted?.[activeInning - 1];

	return (
		<div className={styles.wrapper}>
			<Helmet>
				<title>{`Play-by-play - ${teams.away.teamName} @ ${teams.home.teamName}, ${date}`}</title>
			</Helmet>
			<div className={styles.miniBoxWrap}>
				<MiniBoxScore game={props.liveData} />
			</div>
			<div className={styles.playTypes}>
				<ButtonGroup variant={"contained"}>
					<Button
						autoFocus={false}
						color={mode === "scoring" ? "primary" : "default"}
						onClick={() => onPlayModeClick("scoring")}
					>
						Scoring Plays
					</Button>
					<Button
						autoFocus={false}
						color={mode === "all" ? "primary" : "default"}
						onClick={() => onPlayModeClick("all")}
					>
						All Plays
					</Button>
				</ButtonGroup>
			</div>
			<div className={styles.inningWrapper}>
				{!isMedium && mode === "all" && inningsWithPlays.length > 0 && (
					<Tabs
						className={styles.inningTabs}
						orientation={orientation}
						value={activeInning}
						onChange={(e, i) => onInningSelect(i)}
						indicatorColor="primary"
						textColor="primary"
					>
						{
							inningsWithPlays.map(({inning, num}) => (
								<Tab key={num} label={inning.ordinalNum} value={num} />
							))
						}
					</Tabs>
				)}
				{mode === "all" && isMedium && inningsWithPlays.length > 0 && (
					<React.Fragment>
						<div>
							<Button
								autoFocus={false}
								ref={buttonRef}
								aria-controls="simple-menu"
								aria-haspopup="true"
								className={styles.inningButton}
								color={"primary"}
								size={"large"}
								onClick={() => setInningMenuOpen(true)}
								variant={"contained"}
							>
								<IoIosMenu style={{
									marginRight: "0.5rem",
									fontSize: "1.5rem"
								}} />
								{liveData.linescore.innings[activeInning - 1]?.ordinalNum} Inning
							</Button>
						</div>
						<Menu
							keepMounted
							anchorEl={buttonRef.current}
							anchorOrigin={{
								horizontal: "center",
								vertical: "top"
							}}
							open={inningMenuOpen}
							onClose={onMenuClose}
						>
							{
								inningsWithPlays.map(({inning, num}, i) => (
									<MenuItem key={num} onClick={_ => onMenuSelect(num)}>
										{inning.ordinalNum
											? `${inning.ordinalNum} Inning`
											: `Inning ${i + 1}`}
									</MenuItem>
								))
							}
						</Menu>
					</React.Fragment>
				)}

				{halfInningsChosen && keys?.length > 0 && mode === "all" && (
					<Inning
						isCurrentInning={activeInning === liveData.linescore.currentInning}
						halfInnings={halfInningsChosen}
						keysSorted={keys}
					/>
				)}

				{mode === "scoring" && (
					<ScoringPlays
						liveData={liveData}
					/>
				)}
			</div>
		</div>
	);

});
