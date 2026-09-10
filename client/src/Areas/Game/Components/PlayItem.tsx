import * as React from "react";
import {LiveGamePlay, LiveGamePlayEvent} from "baseball-theater-engine";
import {Chip, Collapse, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText} from "@material-ui/core";
import {Strikezone} from "./Strikezone";
import {PitchItem} from "./PitchItem";
import styles from "./PlayItem.module.scss";
import {ExpandLess, ExpandMore} from "@material-ui/icons";
import {MdInfoOutline, MdVideoLibrary} from "react-icons/all";
import Avatar from "@material-ui/core/Avatar";
import {AuthDataStore, BackerType, IAuthContext} from "../../../Global/AuthDataStore";
import classNames from "classnames";
import Tooltip from "@material-ui/core/Tooltip";
import moment from "moment";
import {UpsellDataStore} from "./UpsellDataStore";
import {StringUtils} from "../../../Utility/StringUtils";

interface IPlayItemProps
{
	play: LiveGamePlay;
	showOtherEvents: boolean;
	defaultExpanded: boolean;
}

interface DefaultProps
{
}

type Props = IPlayItemProps & DefaultProps;
type State = IPlayItemState;

interface IPlayItemState
{
	userExpanded: boolean;
	auth: IAuthContext;
}

export class PlayItem extends React.Component<Props, State>
{
	constructor(props: Props)
	{
		super(props);

		this.state = {
			userExpanded: false,
			auth: AuthDataStore.state
		};
	}

	private get expanded()
	{
		return this.state.userExpanded || this.props.defaultExpanded;
	}

	public componentDidMount(): void
	{
		AuthDataStore.listen(auth => this.setState({auth}));
	}

	private toggle = () => this.setState({
		userExpanded: !this.state.userExpanded
	});

	private renderPlayDetails(pitchItems: React.ReactNode, finalHit?: LiveGamePlayEvent)
	{
		const {play} = this.props;
		const {result} = play;

		const details = (
			<>
				<div className={styles.pitcher}>
					<Chip label={`B: ${play.matchup.batter.fullName} (${play.matchup.batSide.code})`}/>
					<Chip style={{marginLeft: "auto"}} label={`P: ${play.matchup.pitcher.fullName} (${play.matchup.pitchHand.code})`}/>
				</div>
				{this.props.defaultExpanded && result.description && (
					<div className={styles.result}>
						{result.description}
					</div>
				)}
				<div className={styles.pitches}>
					<Strikezone play={play}/>
					<List key={play.about.atBatIndex}>
						{pitchItems}
					</List>
				</div>
				{finalHit && (
					<List>
						<ListItem>EV: {finalHit.hitData.launchSpeed} MPH</ListItem>
						<ListItem>Launch Angle: {finalHit.hitData.launchAngle}°</ListItem>
						<ListItem>Distance: {finalHit.hitData.totalDistance}'</ListItem>
						<ListItem>Hardness: {StringUtils.toProperCase(finalHit.hitData.hardness)}</ListItem>
						<ListItem>Type: {StringUtils.toProperCase(finalHit.hitData.trajectory?.replace("_", " "))}</ListItem>
					</List>
				)}
			</>
		);

		// Live current at-bats stay open; Collapse + React 18 can leave stale pitch rows behind.
		if (this.props.defaultExpanded)
		{
			return <div className={styles.playDetails}>{details}</div>;
		}

		return (
			<Collapse in={this.expanded} className={styles.playDetails} unmountOnExit>
				{details}
			</Collapse>
		);
	}

	public render()
	{
		const {
			play,
			showOtherEvents
		} = this.props;

		const {
			about,
			result,
			pitchIndex,
			playEvents
		} = this.props.play;

		const firstPitchIndex = pitchIndex[0];
		const pitchItems = playEvents.map((pe, i) =>
		{
			if (pitchIndex.includes(i))
			{
				return <PitchItem auth={this.state.auth} key={pe.playId ?? `pitch-${pe.index}-${i}`} pitch={pe}/>;
			}

			if (firstPitchIndex !== undefined && i >= firstPitchIndex)
			{
				return <NonPitchEvent key={pe.playId ?? `action-${pe.index}-${i}`} pe={pe}/>;
			}

			return null;
		});

		const playEventsLength = this.props.play?.playEvents?.length ?? 1;
		const playId = this.props.play.playEvents?.[playEventsLength - 1]?.playId;

		const authed = AuthDataStore.hasLevel(BackerType.ProBacker);
		const playVideoEnabled = moment().isAfter(moment(about.endTime).add(36, "hour"));
		const href = authed && playVideoEnabled ? `https://baseballsavant.mlb.com/sporty-videos?playId=${playId}` : "#";
		const avatarClasses = classNames(styles.videoAvatar, {
			[styles.unauthed]: !authed
		});

		let label = "Video of play";
		if (!playVideoEnabled)
		{
			label += " (not available until 2 days after game)";
		}
		const tooltip = (
			<div style={{textAlign: "center", fontSize: "0.8rem"}}>
				<div>{label}</div>
			</div>
		);

		const nonPitchPlays = play.playEvents.filter(pe => !pe.isPitch).slice(0, pitchIndex[0]);

		const finalHit = play.playEvents.filter(a => !!a.hitData)?.reverse()?.[0];

		return (
			<>
				{showOtherEvents && nonPitchPlays.map((pe, i) => (
					<div className={styles.nonPitchEvent} key={pe.playId ?? `pre-${pe.index}-${i}`}>
						<MdInfoOutline className={styles.nonPitchEventIcon}/>
						<div>{pe.details.description}</div>
					</div>
				))}
				<ListItem button onClick={this.toggle}>
					<ListItemAvatar>
						{playId &&
                        <Tooltip title={tooltip} arrow enterTouchDelay={0}>
                            <Avatar className={avatarClasses}>
                                <a target={"_blank"} href={href}
                                   onClick={e =>
								   {
									   e.stopPropagation();
									   if (!authed || !playVideoEnabled)
									   {
										   if (!authed)
										   {
											   UpsellDataStore.open(BackerType.ProBacker);
										   }
										   e.preventDefault();
									   }
								   }}>
                                    <MdVideoLibrary/>
                                </a>
                            </Avatar>
                        </Tooltip>
						}
					</ListItemAvatar>
					<ListItemText
						primary={result.event || `${play.matchup.batter.fullName} hits against ${play.matchup.pitcher.fullName}`}
						secondary={result.description}
					/>
					<ListItemSecondaryAction>
						<div className={styles.actions}>
							{this.expanded ? <ExpandLess/> : <ExpandMore/>}
						</div>
					</ListItemSecondaryAction>
				</ListItem>
				{this.renderPlayDetails(pitchItems, finalHit)}
			</>
		);
	}
}

const NonPitchEvent: React.FC<{ pe: LiveGamePlayEvent }> = ({pe}) =>
{
	return (
		<div className={styles.nonPitchEvent}>
			<MdInfoOutline className={styles.nonPitchEventIcon}/>
			<div>{pe.details.description}</div>
		</div>
	);
}