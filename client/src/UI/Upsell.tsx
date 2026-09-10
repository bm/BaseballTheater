import { Button, Typography } from '@material-ui/core';
import DialogActions from '@material-ui/core/DialogActions';
import withStyles from '@material-ui/core/styles/withStyles';
import classNames from 'classnames';
import * as React from 'react';
import { AiOutlineCloseCircle } from 'react-icons/all';

import { BackerType } from '../Global/AuthDataStore';
import { getPatreonAuthUrl } from '../Global/PatreonAuth';
import styles from './Upsell.module.scss';

interface IUpsellProps
{
	levelRequired: BackerType;
	isModal: boolean;
	hideClose?: boolean;
	onCancel?: () => void;
	titleOverride?: React.ReactNode;
}

interface DefaultProps
{
}

type Props = IUpsellProps & DefaultProps;
type State = IUpsellState;

interface IUpsellState
{
}

const PatreonButton = withStyles({
	root: {
		backgroundColor: "#f96854",
		"&:hover": {
			backgroundColor: "#ff8777"
		}
	},
})(Button);

export class Upsell extends React.Component<Props, State>
{
	constructor(props: Props)
	{
		super(props);

		this.state = {};
	}

	private get patreonUrl()
	{
		return getPatreonAuthUrl();
	}

	public render()
	{
		const classes = classNames(styles.wrapper, {
			[styles.isModal]: this.props.isModal
		});

		const title = this.props.titleOverride || (
			<React.Fragment>
				This feature is reserved for <strong>{this.props.levelRequired}s</strong>
			</React.Fragment>
		);

		return (
			<>
				{!this.props.hideClose && (
					<div className={styles.close} onClick={this.props.onCancel}>
						<AiOutlineCloseCircle/>
					</div>
				)}
				<div className={classes}>
					<div className={styles.inner}>
						<Typography variant={"h5"} className={styles.title}>
							{title}
						</Typography>
						<Typography>
							Baseball Theater is fan-funded by Patreon donations. If you enjoy the site, please consider joining to help keep the site alive!
						</Typography>
					</div>
				</div>
				<DialogActions>
					<a className={styles.patreonButtonLink} href={"https://www.patreon.com/jakelauer"} target={"_blank"} rel={"nofollow noreferrer"}>
						<PatreonButton className={styles.patreonJoin}>
							Become a Patron
						</PatreonButton>
					</a>
					<a className={styles.patreonButtonLink} href={this.patreonUrl}>
						<PatreonButton onClick={this.props.onCancel} style={{backgroundColor: "#EEE", margin: 8}}>Log In</PatreonButton>
					</a>
				</DialogActions>
			</>
		);
	}
}